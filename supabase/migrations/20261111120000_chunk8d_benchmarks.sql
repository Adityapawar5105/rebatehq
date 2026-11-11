-- 8D: opt-in anonymous benchmarks (BENCHMARKS_DESIGN.md, approved 11 November 2026).
-- Only the Owner's consent row is a tenant table. Contributions and releases are pseudonymous: they live in the
-- unexposed private schema with tenant_id constrained to NULL, no app or platform privileges, and no row audit
-- (an audit row would re-link a contribution to its sender). The pseudonym is HMAC-SHA256(server key, tenant ‖
-- quarter), computed by the API with a key that is never stored in this database.
-- Rollback: stop the benchmark API (BENCHMARKS_ENABLED); a later reviewed migration may drop these objects.
-- Never edit an applied migration or replay old ACL migrations after restore.
BEGIN;

CREATE TABLE public.bench_consent (
 tenant_id uuid PRIMARY KEY REFERENCES public.tenant(tenant_id),
 opted_in boolean NOT NULL,
 consent_version integer NOT NULL CHECK(consent_version BETWEEN 1 AND 1000),
 decided_by uuid NOT NULL,
 decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(tenant_id,decided_by) REFERENCES public.membership(tenant_id,user_id)
);

CREATE TABLE rebatehq_private.bench_submission (
 tenant_id uuid CHECK(tenant_id IS NULL),
 pseudonym bytea NOT NULL CHECK(octet_length(pseudonym)=32),
 quarter text NOT NULL CHECK(quarter ~ '^20[2-9][0-9]-Q[1-4]$'),
 size_band text NOT NULL CHECK(size_band IN ('S1','S2','S3','S4')),
 day date NOT NULL,
 day_count integer NOT NULL CHECK(day_count BETWEEN 1 AND 5),
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(pseudonym,quarter)
);
CREATE TABLE rebatehq_private.bench_contribution (
 tenant_id uuid CHECK(tenant_id IS NULL),
 pseudonym bytea NOT NULL,
 quarter text NOT NULL,
 family text NOT NULL CHECK(family IN ('electrical','plumbing','hvac','industrial_mro','fasteners','safety','janitorial','packaging','building_materials','foodservice','medical','other')),
 metric text NOT NULL CHECK(metric IN ('pocket_margin','discount_rate','rebate_rate','freight_rate')),
 band integer NOT NULL CHECK(band BETWEEN -20 AND 80),
 PRIMARY KEY(pseudonym,quarter,family,metric),
 FOREIGN KEY(pseudonym,quarter) REFERENCES rebatehq_private.bench_submission(pseudonym,quarter) ON DELETE CASCADE
);
CREATE INDEX bench_contribution_cell_idx ON rebatehq_private.bench_contribution(quarter,family,metric);
CREATE TABLE rebatehq_private.bench_release (
 tenant_id uuid CHECK(tenant_id IS NULL),
 quarter text NOT NULL CHECK(quarter ~ '^20[2-9][0-9]-Q[1-4]$'),
 size_band text NOT NULL CHECK(size_band IN ('S1','S2','S3','S4')),
 family text NOT NULL,
 metric text NOT NULL,
 p25 integer NOT NULL CHECK(p25 BETWEEN -20 AND 80 AND (p25+20)%5=0),
 p50 integer NOT NULL CHECK(p50 BETWEEN -20 AND 80 AND (p50+20)%5=0 AND p50>=p25),
 p75 integer NOT NULL CHECK(p75 BETWEEN -20 AND 80 AND (p75+20)%5=0 AND p75>=p50),
 epsilon numeric(6,3) NOT NULL CHECK(epsilon>0),
 released_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(quarter,size_band,family,metric)
);
CREATE TABLE rebatehq_private.bench_release_log (
 tenant_id uuid CHECK(tenant_id IS NULL),
 quarter text PRIMARY KEY CHECK(quarter ~ '^20[2-9][0-9]-Q[1-4]$'),
 cells integer NOT NULL CHECK(cells>=0),
 released_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE rebatehq_private.bench_submission ENABLE ROW LEVEL SECURITY;
ALTER TABLE rebatehq_private.bench_submission FORCE ROW LEVEL SECURITY;
REVOKE ALL ON rebatehq_private.bench_submission FROM PUBLIC,anon,authenticated,service_role,rebatehq_app;
ALTER TABLE rebatehq_private.bench_contribution ENABLE ROW LEVEL SECURITY;
ALTER TABLE rebatehq_private.bench_contribution FORCE ROW LEVEL SECURITY;
REVOKE ALL ON rebatehq_private.bench_contribution FROM PUBLIC,anon,authenticated,service_role,rebatehq_app;
ALTER TABLE rebatehq_private.bench_release ENABLE ROW LEVEL SECURITY;
ALTER TABLE rebatehq_private.bench_release FORCE ROW LEVEL SECURITY;
REVOKE ALL ON rebatehq_private.bench_release FROM PUBLIC,anon,authenticated,service_role,rebatehq_app;
ALTER TABLE rebatehq_private.bench_release_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE rebatehq_private.bench_release_log FORCE ROW LEVEL SECURITY;
REVOKE ALL ON rebatehq_private.bench_release_log FROM PUBLIC,anon,authenticated,service_role,rebatehq_app;

-- The workspace Owner (active, seated); p_licensed also requires an active Professional or Scale licence.
CREATE FUNCTION public.bench_owner(p_tenant uuid,p_licensed boolean DEFAULT true) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT auth.uid() IS NOT NULL AND public.verified_request_actor()=auth.uid()
 AND EXISTS(SELECT 1 FROM public.membership m JOIN public.licence_seat s ON s.tenant_id=m.tenant_id AND s.user_id=m.user_id
  JOIN public.workspace_licence l ON l.tenant_id=m.tenant_id
  WHERE m.tenant_id=p_tenant AND m.user_id=auth.uid() AND m.status='active' AND m.role='owner'
  AND (NOT p_licensed OR (l.status='active' AND l.tier IN ('professional','scale') AND l.valid_until>statement_timestamp())))
$$;
REVOKE ALL ON FUNCTION public.bench_owner(uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.bench_owner(uuid,boolean) TO rebatehq_app;

-- One quarter's last day.
CREATE FUNCTION public.bench_quarter_end(p_quarter text) RETURNS date
LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT (make_date(substr(p_quarter,1,4)::integer,substr(p_quarter,7,1)::integer*3,1)+interval '1 month'-interval '1 day')::date
$$;
REVOKE ALL ON FUNCTION public.bench_quarter_end(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.bench_quarter_end(text) TO rebatehq_app;

-- Store one workspace's bands for one completed, unreleased quarter, replacing an earlier submission. The payload
-- is checked exactly: at most 48 rows, each with only family, metric and an integer band from -20 to 80.
CREATE FUNCTION public.bench_submit(p_tenant uuid,p_pseudonym bytea,p_quarter text,p_size text,p_rows jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,rebatehq_private,pg_temp AS $$
DECLARE r jsonb; previous rebatehq_private.bench_submission%ROWTYPE; n integer:=0;
BEGIN
 IF NOT public.bench_owner(p_tenant,true) OR NOT EXISTS(SELECT 1 FROM public.bench_consent WHERE tenant_id=p_tenant AND opted_in) THEN
  RAISE EXCEPTION 'benchmark sharing is not allowed' USING ERRCODE='42501'; END IF;
 IF p_pseudonym IS NULL OR octet_length(p_pseudonym)<>32 OR p_quarter IS NULL OR p_quarter !~ '^20[2-9][0-9]-Q[1-4]$'
  OR p_size IS NULL OR p_size NOT IN ('S1','S2','S3','S4') OR p_rows IS NULL OR jsonb_typeof(p_rows)<>'array'
  OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 48 THEN RAISE EXCEPTION 'invalid benchmark payload' USING ERRCODE='22023'; END IF;
 IF public.bench_quarter_end(p_quarter)>=current_date THEN RAISE EXCEPTION 'benchmark quarter is not complete' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM rebatehq_private.bench_release_log WHERE quarter=p_quarter) THEN RAISE EXCEPTION 'benchmark quarter is already released' USING ERRCODE='22023'; END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  IF jsonb_typeof(r)<>'object' OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(r) k)<>ARRAY['band','family','metric']
   OR jsonb_typeof(r->'band')<>'number' OR (r->>'band')!~'^-?[0-9]{1,2}$' OR (r->>'band')::integer NOT BETWEEN -20 AND 80
   OR jsonb_typeof(r->'family')<>'string' OR jsonb_typeof(r->'metric')<>'string' THEN
   RAISE EXCEPTION 'invalid benchmark payload' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF (SELECT count(DISTINCT (value->>'family',value->>'metric')) FROM jsonb_array_elements(p_rows))<>jsonb_array_length(p_rows) THEN
  RAISE EXCEPTION 'invalid benchmark payload' USING ERRCODE='22023'; END IF;
 SELECT * INTO previous FROM rebatehq_private.bench_submission WHERE pseudonym=p_pseudonym AND quarter=p_quarter FOR UPDATE;
 IF FOUND AND previous.day=current_date AND previous.day_count>=5 THEN RAISE EXCEPTION 'benchmark submission limit reached' USING ERRCODE='22023'; END IF;
 DELETE FROM rebatehq_private.bench_contribution WHERE pseudonym=p_pseudonym AND quarter=p_quarter;
 INSERT INTO rebatehq_private.bench_submission(pseudonym,quarter,size_band,day,day_count) VALUES(p_pseudonym,p_quarter,p_size,current_date,1)
 ON CONFLICT(pseudonym,quarter) DO UPDATE SET size_band=excluded.size_band,received_at=clock_timestamp(),
  day_count=CASE WHEN rebatehq_private.bench_submission.day=current_date THEN rebatehq_private.bench_submission.day_count+1 ELSE 1 END,day=current_date;
 -- The family/metric CHECK constraints reject unknown codes (SQLSTATE 23514).
 INSERT INTO rebatehq_private.bench_contribution(pseudonym,quarter,family,metric,band)
 SELECT p_pseudonym,p_quarter,value->>'family',value->>'metric',(value->>'band')::integer FROM jsonb_array_elements(p_rows);
 GET DIAGNOSTICS n=ROW_COUNT;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.bench_submit(uuid,bytea,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.bench_submit(uuid,bytea,text,text,jsonb) TO rebatehq_app;

-- Delete this workspace's stored contributions (the API passes the pseudonyms of every quarter it may have shared).
-- Released figures are aggregates and stay. Works without a current licence so an Owner can always withdraw.
CREATE FUNCTION public.bench_withdraw(p_tenant uuid,p_pseudonyms bytea[]) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,rebatehq_private,pg_temp AS $$
DECLARE n integer;
BEGIN
 IF NOT public.bench_owner(p_tenant,false) THEN RAISE EXCEPTION 'benchmark withdrawal is not allowed' USING ERRCODE='42501'; END IF;
 IF p_pseudonyms IS NULL OR cardinality(p_pseudonyms)>200 OR EXISTS(SELECT 1 FROM unnest(p_pseudonyms) p WHERE p IS NULL OR octet_length(p)<>32) THEN
  RAISE EXCEPTION 'invalid benchmark withdrawal' USING ERRCODE='22023'; END IF;
 DELETE FROM rebatehq_private.bench_submission WHERE pseudonym=ANY(p_pseudonyms);
 GET DIAGNOSTICS n=ROW_COUNT;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.bench_withdraw(uuid,bytea[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.bench_withdraw(uuid,bytea[]) TO rebatehq_app;

-- A released quarter's figures, for an opted-in Owner whose workspace contributed to that quarter (give to get).
CREATE FUNCTION public.bench_figures(p_tenant uuid,p_pseudonym bytea,p_quarter text)
RETURNS TABLE(size_band text,family text,metric text,p25 integer,p50 integer,p75 integer,epsilon numeric,released_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,rebatehq_private,pg_temp AS $$
BEGIN
 IF NOT public.bench_owner(p_tenant,true) OR NOT EXISTS(SELECT 1 FROM public.bench_consent c WHERE c.tenant_id=p_tenant AND c.opted_in) THEN
  RAISE EXCEPTION 'benchmark figures are not available' USING ERRCODE='42501'; END IF;
 IF p_pseudonym IS NULL OR octet_length(p_pseudonym)<>32 OR p_quarter IS NULL OR p_quarter !~ '^20[2-9][0-9]-Q[1-4]$' THEN
  RAISE EXCEPTION 'invalid benchmark request' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM rebatehq_private.bench_submission s WHERE s.pseudonym=p_pseudonym AND s.quarter=p_quarter) THEN
  RAISE EXCEPTION 'share this quarter to see its figures' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT r.size_band,r.family,r.metric,r.p25,r.p50,r.p75,r.epsilon::numeric,r.released_at
  FROM rebatehq_private.bench_release r WHERE r.quarter=p_quarter ORDER BY r.size_band,r.family,r.metric;
END $$;
REVOKE ALL ON FUNCTION public.bench_figures(uuid,bytea,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.bench_figures(uuid,bytea,text) TO rebatehq_app;

-- Operator-only release (no app grant): once per quarter, 45 days after it ends. Each cell (size band, family,
-- metric) with at least p_k contributors gets a histogram over 21 five-point ranges, Laplace(1/epsilon) noise on every
-- range, clamping at 0, and the ranges where the noisy cumulative count reaches 25%, 50% and 75% of the noisy total.
-- A cell whose noisy total is under p_k is suppressed. The release is frozen.
CREATE FUNCTION public.bench_publish(p_quarter text,p_epsilon numeric DEFAULT 1,p_k integer DEFAULT 10) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,rebatehq_private,pg_temp AS $$
DECLARE cell record; noisy numeric[]; total numeric; cum numeric; i integer; u double precision; q numeric[]; res integer[]; j integer; published integer:=0;
BEGIN
 IF p_quarter IS NULL OR p_quarter !~ '^20[2-9][0-9]-Q[1-4]$' OR p_epsilon IS NULL OR p_epsilon<=0 OR p_k IS NULL OR p_k<10 THEN
  RAISE EXCEPTION 'invalid benchmark release' USING ERRCODE='22023'; END IF;
 IF public.bench_quarter_end(p_quarter)+45>current_date THEN RAISE EXCEPTION 'benchmark quarter is not ready for release' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM rebatehq_private.bench_release_log WHERE quarter=p_quarter) THEN RAISE EXCEPTION 'benchmark quarter is already released' USING ERRCODE='22023'; END IF;
 FOR cell IN SELECT s.size_band,c.family,c.metric,array_agg((c.band+20)/5) AS buckets,count(*) AS n
  FROM rebatehq_private.bench_contribution c JOIN rebatehq_private.bench_submission s USING(pseudonym,quarter)
  WHERE c.quarter=p_quarter GROUP BY s.size_band,c.family,c.metric HAVING count(*)>=p_k ORDER BY 1,2,3 LOOP
  noisy:=array_fill(0::numeric,ARRAY[21]);
  FOR i IN 1..21 LOOP
   u:=random()-0.5;
   noisy[i]:=greatest(0,(SELECT count(*) FROM unnest(cell.buckets) b WHERE b=i-1)
    -(1/p_epsilon)*sign(u)::numeric*ln(greatest(1e-12,1-2*abs(u)))::numeric);
  END LOOP;
  total:=(SELECT sum(x) FROM unnest(noisy) x);
  CONTINUE WHEN total<p_k;
  q:=ARRAY[0.25,0.5,0.75]; res:=ARRAY[NULL,NULL,NULL]::integer[];
  FOR j IN 1..3 LOOP
   cum:=0;
   FOR i IN 1..21 LOOP cum:=cum+noisy[i]; IF cum>=q[j]*total THEN res[j]:=(i-1)*5-20; EXIT; END IF; END LOOP;
  END LOOP;
  INSERT INTO rebatehq_private.bench_release(quarter,size_band,family,metric,p25,p50,p75,epsilon)
  VALUES(p_quarter,cell.size_band,cell.family,cell.metric,res[1],res[2],res[3],p_epsilon);
  published:=published+1;
 END LOOP;
 INSERT INTO rebatehq_private.bench_release_log(quarter,cells) VALUES(p_quarter,published);
 RETURN published;
END $$;
REVOKE ALL ON FUNCTION public.bench_publish(text,numeric,integer) FROM PUBLIC,anon,authenticated,service_role,rebatehq_app;
GRANT EXECUTE ON FUNCTION public.bench_publish(text,numeric,integer) TO CURRENT_USER;

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['bench_consent'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
 END LOOP;
END $$;
REVOKE ALL ON public.bench_consent FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.bench_consent TO rebatehq_app;
CREATE POLICY bench_consent_select ON public.bench_consent FOR SELECT TO rebatehq_app USING(public.bench_owner(tenant_id,false));
CREATE POLICY bench_consent_insert ON public.bench_consent FOR INSERT TO rebatehq_app WITH CHECK(public.bench_owner(tenant_id,opted_in) AND decided_by=auth.uid());
CREATE POLICY bench_consent_update ON public.bench_consent FOR UPDATE TO rebatehq_app USING(public.bench_owner(tenant_id,false)) WITH CHECK(public.bench_owner(tenant_id,opted_in) AND decided_by=auth.uid());
CREATE TRIGGER bench_consent_audit_row AFTER INSERT OR UPDATE ON public.bench_consent FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
COMMIT;
