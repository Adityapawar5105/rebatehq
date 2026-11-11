-- 8D: opt-in anonymous benchmarks. Explicit rollback-only fixtures; 17 checks.
RESET ROLE;
SELECT pg_temp.use_identity('');
CREATE TEMP TABLE bench_test_people(label text PRIMARY KEY,tenant_id uuid,user_id uuid,member_role text,tier text);
INSERT INTO pg_temp.bench_test_people VALUES
 ('A','__PHASE1_BENCH_TENANT_A_ID__','__PHASE1_BENCH_USER_A_ID__','owner','professional'),
 ('B','__PHASE1_BENCH_TENANT_B_ID__','__PHASE1_BENCH_USER_B_ID__','owner','scale'),
 ('R','__PHASE1_BENCH_TENANT_A_ID__','__PHASE1_BENCH_USER_R_ID__','rep',NULL),
 ('S','__PHASE1_BENCH_TENANT_S_ID__','__PHASE1_BENCH_USER_S_ID__','owner','starter');
INSERT INTO auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
 SELECT user_id,'authenticated','authenticated',user_id::text||'@example.invalid','',now(),now(),now() FROM pg_temp.bench_test_people;
INSERT INTO public.tenant(tenant_id,name,created_by) SELECT tenant_id,'8D fixture '||label,user_id FROM pg_temp.bench_test_people WHERE label IN ('A','B','S');
INSERT INTO public.membership(tenant_id,user_id,email,role) SELECT tenant_id,user_id,user_id::text||'@example.invalid',member_role FROM pg_temp.bench_test_people;
INSERT INTO public.workspace_licence(tenant_id,tier,valid_until) SELECT tenant_id,tier,now()+interval '30 days' FROM pg_temp.bench_test_people WHERE tier IS NOT NULL;
INSERT INTO public.licence_seat(tenant_id,user_id) SELECT tenant_id,user_id FROM pg_temp.bench_test_people;
INSERT INTO public.bench_consent(tenant_id,opted_in,consent_version,decided_by) VALUES('__PHASE1_BENCH_TENANT_B_ID__',true,1,'__PHASE1_BENCH_USER_B_ID__');
SELECT set_config('app.bench_open_quarter',to_char(current_date,'YYYY')||'-Q'||extract(quarter FROM current_date)::text,true);

-- 1. The Owner opts in under the restricted role; sees only their own consent.
SELECT pg_temp.use_identity('__PHASE1_BENCH_USER_A_ID__');
SET LOCAL ROLE rebatehq_app;
DO $$ DECLARE n integer; BEGIN IF current_user<>'rebatehq_app' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION '8D unsafe app role'; END IF;
 INSERT INTO public.bench_consent(tenant_id,opted_in,consent_version,decided_by) VALUES('__PHASE1_BENCH_TENANT_A_ID__',true,1,'__PHASE1_BENCH_USER_A_ID__');
 SELECT count(*) INTO n FROM public.bench_consent WHERE tenant_id='__PHASE1_BENCH_TENANT_A_ID__'; IF n<>1 THEN RAISE EXCEPTION '8D own consent not visible'; END IF;
 SELECT count(*) INTO n FROM public.bench_consent WHERE tenant_id='__PHASE1_BENCH_TENANT_B_ID__'; IF n<>0 THEN RAISE EXCEPTION '8D cross consent leaked'; END IF;
END $$;
RESET ROLE;
SELECT extensions.ok(true,'8D bench_consent: Owner opts in under the app role and sees only their own consent');
-- 2. Writing another tenant's consent is an RLS denial, not a missing privilege.
SELECT pg_temp.use_identity('__PHASE1_BENCH_USER_A_ID__');
SET LOCAL ROLE rebatehq_app;
DO $$ DECLARE msg text; BEGIN
 BEGIN INSERT INTO public.bench_consent(tenant_id,opted_in,consent_version,decided_by) VALUES('__PHASE1_BENCH_TENANT_S_ID__',true,1,'__PHASE1_BENCH_USER_A_ID__'); RAISE EXCEPTION '8D cross consent allowed';
 EXCEPTION WHEN insufficient_privilege THEN GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT; IF position('row-level security' in lower(msg))=0 THEN RAISE EXCEPTION '8D denial was not RLS: %',msg; END IF; END;
END $$;
RESET ROLE;
SELECT extensions.ok(true,'8D bench_consent: cross-tenant INSERT rejected by RLS 42501');
-- 3. A rep can neither read nor write the workspace consent.
SELECT pg_temp.use_identity('__PHASE1_BENCH_USER_R_ID__');
SET LOCAL ROLE rebatehq_app;
DO $$ DECLARE n integer; msg text; BEGIN
 SELECT count(*) INTO n FROM public.bench_consent; IF n<>0 THEN RAISE EXCEPTION '8D rep reads consent'; END IF;
 BEGIN UPDATE public.bench_consent SET opted_in=false,decided_by='__PHASE1_BENCH_USER_R_ID__' WHERE tenant_id='__PHASE1_BENCH_TENANT_A_ID__';
  GET DIAGNOSTICS n=ROW_COUNT; IF n<>0 THEN RAISE EXCEPTION '8D rep changed consent'; END IF; END;
END $$;
RESET ROLE;
SELECT extensions.is((SELECT opted_in::text FROM public.bench_consent WHERE tenant_id='__PHASE1_BENCH_TENANT_A_ID__'),'true','8D bench_consent: a rep cannot read or change consent');
-- 4. A Starter Owner may record a refusal but not opt in.
SELECT pg_temp.use_identity('__PHASE1_BENCH_USER_S_ID__');
SET LOCAL ROLE rebatehq_app;
DO $$ DECLARE msg text; BEGIN
 BEGIN INSERT INTO public.bench_consent(tenant_id,opted_in,consent_version,decided_by) VALUES('__PHASE1_BENCH_TENANT_S_ID__',true,1,'__PHASE1_BENCH_USER_S_ID__'); RAISE EXCEPTION '8D starter opted in';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 INSERT INTO public.bench_consent(tenant_id,opted_in,consent_version,decided_by) VALUES('__PHASE1_BENCH_TENANT_S_ID__',false,1,'__PHASE1_BENCH_USER_S_ID__');
END $$;
RESET ROLE;
SELECT extensions.is((SELECT opted_in::text FROM public.bench_consent WHERE tenant_id='__PHASE1_BENCH_TENANT_S_ID__'),'false','8D bench_consent: Starter Owner cannot opt in, can record a refusal');
-- 5. The Owner shares a completed quarter: two rows stored, pseudonymous, no tenant.
SELECT pg_temp.use_identity('__PHASE1_BENCH_USER_A_ID__');
SET LOCAL ROLE rebatehq_app;
DO $$ DECLARE n integer; BEGIN
 n:=public.bench_submit('__PHASE1_BENCH_TENANT_A_ID__',decode(repeat('a1',32),'hex'),'2025-Q1','S2','[{"family":"electrical","metric":"pocket_margin","band":22},{"family":"electrical","metric":"discount_rate","band":11}]'::jsonb);
 IF n<>2 THEN RAISE EXCEPTION '8D submit stored % rows',n; END IF;
END $$;
RESET ROLE;
SELECT extensions.is((SELECT count(*)::integer FROM rebatehq_private.bench_contribution WHERE pseudonym=decode(repeat('a1',32),'hex') AND tenant_id IS NULL),2,'8D bench_submit: Owner shares 2 bands under a pseudonym with no tenant');
-- 6-11. The payload is checked exactly.
SELECT pg_temp.use_identity('__PHASE1_BENCH_USER_A_ID__');
SET LOCAL ROLE rebatehq_app;
DO $$ DECLARE bad text[]:=ARRAY[
 '[{"family":"electrical","metric":"pocket_margin","band":22,"customer":"C1"}]',
 '[{"family":"electrical","metric":"pocket_margin","band":81}]',
 '[{"family":"electrical","metric":"pocket_margin","band":22.5}]',
 '[{"family":"electrical","metric":"pocket_margin","band":"22"}]',
 '[{"family":"electrical","metric":"pocket_margin","band":22},{"family":"electrical","metric":"pocket_margin","band":23}]',
 '[]','{"family":"electrical"}']; p text; BEGIN
 FOREACH p IN ARRAY bad LOOP
  BEGIN PERFORM public.bench_submit('__PHASE1_BENCH_TENANT_A_ID__',decode(repeat('a1',32),'hex'),'2025-Q1','S2',p::jsonb); RAISE EXCEPTION '8D bad payload accepted: %',p;
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
 END LOOP;
END $$;
RESET ROLE;
SELECT extensions.ok(true,'8D bench_submit: extra keys, out-of-range, decimal, string and duplicate bands, empty and non-array payloads refused (22023)');
SELECT pg_temp.use_identity('__PHASE1_BENCH_USER_A_ID__');
SET LOCAL ROLE rebatehq_app;
DO $$ BEGIN
 BEGIN PERFORM public.bench_submit('__PHASE1_BENCH_TENANT_A_ID__',decode(repeat('a1',32),'hex'),'2025-Q1','S2','[{"family":"tools","metric":"pocket_margin","band":22}]'::jsonb); RAISE EXCEPTION '8D unknown family accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN PERFORM public.bench_submit('__PHASE1_BENCH_TENANT_A_ID__',decode(repeat('a1',32),'hex'),'2025-Q1','S9','[{"family":"electrical","metric":"pocket_margin","band":22}]'::jsonb); RAISE EXCEPTION '8D unknown size band accepted';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
 BEGIN PERFORM public.bench_submit('__PHASE1_BENCH_TENANT_A_ID__',decode(repeat('a1',16),'hex'),'2025-Q1','S2','[{"family":"electrical","metric":"pocket_margin","band":22}]'::jsonb); RAISE EXCEPTION '8D short pseudonym accepted';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
END $$;
RESET ROLE;
SELECT extensions.is((SELECT count(*)::integer FROM rebatehq_private.bench_contribution WHERE pseudonym=decode(repeat('a1',32),'hex')),2,'8D bench_submit: unknown family (23514), size band and pseudonym refused; earlier rows kept');
SELECT pg_temp.use_identity('__PHASE1_BENCH_USER_A_ID__');
SET LOCAL ROLE rebatehq_app;
DO $$ BEGIN
 BEGIN PERFORM public.bench_submit('__PHASE1_BENCH_TENANT_A_ID__',decode(repeat('a1',32),'hex'),current_setting('app.bench_open_quarter'),'S2','[{"family":"electrical","metric":"pocket_margin","band":22}]'::jsonb); RAISE EXCEPTION '8D open quarter accepted';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
END $$;
RESET ROLE;
SELECT extensions.ok(true,'8D bench_submit: the current, incomplete quarter is refused');
-- 12. At most 5 submissions a day per workspace and quarter (the first one above counts).
SELECT pg_temp.use_identity('__PHASE1_BENCH_USER_A_ID__');
SET LOCAL ROLE rebatehq_app;
DO $$ BEGIN
 FOR i IN 1..4 LOOP PERFORM public.bench_submit('__PHASE1_BENCH_TENANT_A_ID__',decode(repeat('a1',32),'hex'),'2025-Q1','S2','[{"family":"electrical","metric":"pocket_margin","band":22},{"family":"electrical","metric":"discount_rate","band":11}]'::jsonb); END LOOP;
 BEGIN PERFORM public.bench_submit('__PHASE1_BENCH_TENANT_A_ID__',decode(repeat('a1',32),'hex'),'2025-Q1','S2','[{"family":"electrical","metric":"pocket_margin","band":22}]'::jsonb); RAISE EXCEPTION '8D sixth submission accepted';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
END $$;
RESET ROLE;
SELECT extensions.is((SELECT day_count FROM rebatehq_private.bench_submission WHERE pseudonym=decode(repeat('a1',32),'hex') AND quarter='2025-Q1'),5,'8D bench_submit: a sixth submission in one day is refused; resubmission replaces rows');
-- 13. A rep, a Starter Owner and a workspace without consent cannot share.
DO $$ DECLARE who text[]:=ARRAY['__PHASE1_BENCH_USER_R_ID__|__PHASE1_BENCH_TENANT_A_ID__','__PHASE1_BENCH_USER_S_ID__|__PHASE1_BENCH_TENANT_S_ID__']; w text; BEGIN
 FOREACH w IN ARRAY who LOOP
  PERFORM pg_temp.use_identity(split_part(w,'|',1));
  BEGIN PERFORM public.bench_submit(split_part(w,'|',2)::uuid,decode(repeat('b2',32),'hex'),'2025-Q1','S1','[{"family":"other","metric":"pocket_margin","band":5}]'::jsonb); RAISE EXCEPTION '8D unauthorised submit accepted for %',w;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 END LOOP;
END $$;
SELECT pg_temp.use_identity('');
SELECT extensions.ok(true,'8D bench_submit: rep and Starter Owner refused with 42501');
-- 14. The app role has no privilege on any private benchmark table and cannot release.
SELECT extensions.ok(NOT EXISTS(SELECT 1 FROM unnest(ARRAY['bench_submission','bench_contribution','bench_release','bench_release_log']) t
 WHERE has_table_privilege('rebatehq_app','rebatehq_private.'||t,'SELECT') OR has_table_privilege('rebatehq_app','rebatehq_private.'||t,'INSERT')
 OR has_table_privilege('rebatehq_app','rebatehq_private.'||t,'UPDATE') OR has_table_privilege('rebatehq_app','rebatehq_private.'||t,'DELETE'))
 AND NOT has_function_privilege('rebatehq_app','public.bench_publish(text,numeric,integer)','EXECUTE'),
 '8D private benchmark tables: no app privilege; bench_publish is operator-only');
-- 15. Give to get: a workspace that did not share the quarter cannot see it; the sharer sees nothing before release.
SELECT pg_temp.use_identity('__PHASE1_BENCH_USER_B_ID__');
SET LOCAL ROLE rebatehq_app;
DO $$ BEGIN
 BEGIN PERFORM * FROM public.bench_figures('__PHASE1_BENCH_TENANT_B_ID__',decode(repeat('c3',32),'hex'),'2025-Q1'); RAISE EXCEPTION '8D non-contributor saw figures';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT pg_temp.use_identity('__PHASE1_BENCH_USER_A_ID__');
SET LOCAL ROLE rebatehq_app;
DO $$ DECLARE n integer; BEGIN SELECT count(*) INTO n FROM public.bench_figures('__PHASE1_BENCH_TENANT_A_ID__',decode(repeat('a1',32),'hex'),'2025-Q1'); IF n<>0 THEN RAISE EXCEPTION '8D figures before release'; END IF; END $$;
RESET ROLE;
SELECT extensions.ok(true,'8D bench_figures: non-contributor refused (42501); contributor sees nothing before release');
-- 16. Release: the cell with 12 contributors is published as 5-point ranges; a 3-contributor cell is suppressed; frozen.
SELECT pg_temp.use_identity('');
INSERT INTO rebatehq_private.bench_submission(pseudonym,quarter,size_band,day,day_count)
 SELECT decode(lpad(to_hex(g),2,'0')||repeat('d4',31),'hex'),'2025-Q1','S2',current_date,1 FROM generate_series(1,14) g;
INSERT INTO rebatehq_private.bench_contribution(pseudonym,quarter,family,metric,band)
 SELECT decode(lpad(to_hex(g),2,'0')||repeat('d4',31),'hex'),'2025-Q1','electrical','pocket_margin',20+g%5 FROM generate_series(1,11) g
 UNION ALL SELECT decode(lpad(to_hex(g),2,'0')||repeat('d4',31),'hex'),'2025-Q1','plumbing','pocket_margin',30 FROM generate_series(12,14) g;
SELECT setseed(0.42);
SELECT extensions.is(public.bench_publish('2025-Q1',1,10),1,'8D bench_publish: 12 contributors published, 3 suppressed (k = 10)');
SELECT extensions.ok((SELECT bool_and(p25%5=0 AND p50%5=0 AND p75%5=0 AND p25<=p50 AND p50<=p75 AND epsilon=1) FROM rebatehq_private.bench_release WHERE quarter='2025-Q1')
 AND NOT EXISTS(SELECT 1 FROM rebatehq_private.bench_release WHERE quarter='2025-Q1' AND family='plumbing'),'8D bench_publish: percentiles are ordered 5-point range edges; the small cell is absent');
DO $$ BEGIN
 BEGIN PERFORM public.bench_publish('2025-Q1',1,10); RAISE EXCEPTION '8D quarter released twice'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
 BEGIN PERFORM public.bench_publish(current_setting('app.bench_open_quarter'),1,10); RAISE EXCEPTION '8D open quarter released'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
 BEGIN PERFORM public.bench_publish('2025-Q2',1,5); RAISE EXCEPTION '8D k below 10 accepted'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
END $$;
SELECT extensions.ok(true,'8D bench_publish: a released quarter is frozen; open quarters and k under 10 refused');
-- 17. After release the contributor sees the figures; sharing that quarter again is refused.
SELECT pg_temp.use_identity('__PHASE1_BENCH_USER_A_ID__');
SET LOCAL ROLE rebatehq_app;
DO $$ DECLARE n integer; BEGIN
 SELECT count(*) INTO n FROM public.bench_figures('__PHASE1_BENCH_TENANT_A_ID__',decode(repeat('a1',32),'hex'),'2025-Q1'); IF n<>1 THEN RAISE EXCEPTION '8D contributor saw % cells',n; END IF;
 BEGIN PERFORM public.bench_submit('__PHASE1_BENCH_TENANT_A_ID__',decode(repeat('a1',32),'hex'),'2025-Q1','S2','[{"family":"electrical","metric":"pocket_margin","band":22}]'::jsonb); RAISE EXCEPTION '8D released quarter accepted';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
END $$;
RESET ROLE;
SELECT extensions.ok(true,'8D bench_figures: the contributor sees the released cell; a released quarter takes no new submission');
-- 18. Withdrawal deletes the workspace's rows (any licence state); a rep cannot withdraw; no row audit names a contribution.
SELECT pg_temp.use_identity('__PHASE1_BENCH_USER_R_ID__');
SET LOCAL ROLE rebatehq_app;
DO $$ BEGIN
 BEGIN PERFORM public.bench_withdraw('__PHASE1_BENCH_TENANT_A_ID__',ARRAY[decode(repeat('a1',32),'hex')]); RAISE EXCEPTION '8D rep withdrew';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT pg_temp.use_identity('__PHASE1_BENCH_USER_A_ID__');
SET LOCAL ROLE rebatehq_app;
DO $$ DECLARE n integer; BEGIN
 n:=public.bench_withdraw('__PHASE1_BENCH_TENANT_A_ID__',ARRAY[decode(repeat('a1',32),'hex'),decode(repeat('e5',32),'hex')]); IF n<>1 THEN RAISE EXCEPTION '8D withdrew % submissions',n; END IF;
END $$;
RESET ROLE;
SELECT pg_temp.use_identity('');
SELECT extensions.ok(NOT EXISTS(SELECT 1 FROM rebatehq_private.bench_contribution WHERE pseudonym=decode(repeat('a1',32),'hex'))
 AND EXISTS(SELECT 1 FROM public.audit_log WHERE tenant_id='__PHASE1_BENCH_TENANT_A_ID__' AND action='bench_consent.insert')
 AND NOT EXISTS(SELECT 1 FROM public.audit_log WHERE entity_type LIKE 'bench\_%' AND entity_type<>'bench_consent'),
 '8D bench_withdraw: rows deleted, rep refused; consent is audited and no audit row names a contribution');
SELECT pg_temp.use_identity('');
