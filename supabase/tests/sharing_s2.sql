-- Team sharing S2 (migration 20261125120000_sharing_s2_packs.sql): relay_pack_wrap and relay_pack_version.
-- Runs after the 7A checks, which leave tenant A on Starter with R suspended and device A2 revoked; the operator
-- puts tenant A back on Professional and reactivates R first (rollback-only fixtures, like 7A).
RESET ROLE;
SELECT pg_temp.use_identity('');
UPDATE public.workspace_licence SET tier='professional' WHERE tenant_id='__PHASE1_RELAY_TENANT_A_ID__';
UPDATE public.membership SET status='active' WHERE tenant_id='__PHASE1_RELAY_TENANT_A_ID__' AND user_id='__PHASE1_RELAY_USER_R_ID__';
SELECT set_config('app.share_grid',jsonb_build_object('v','1','namedOwner',NULL,'people',jsonb_build_array(
 jsonb_build_object('userId','__PHASE1_RELAY_USER_A_ID__','role','owner','extras','[]'::jsonb),
 jsonb_build_object('userId','__PHASE1_RELAY_USER_R_ID__','role','sales_rep','extras','[]'::jsonb)),'ticks','[]'::jsonb)::text,true);

SELECT extensions.ok((SELECT bool_and(c.relrowsecurity AND c.relforcerowsecurity
 AND EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid AND t.tgname=c.relname||'_audit_row')
 AND EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid AND t.tgname=c.relname||'_validate'))
 FROM pg_class c WHERE c.oid IN ('public.relay_pack_wrap'::regclass,'public.relay_pack_version'::regclass)),
 'S2 pack tables: forced RLS, validation and audit triggers');
SELECT extensions.ok((SELECT bool_and(x.ok) FROM (SELECT (SELECT array_agg(a.privilege_type ORDER BY a.privilege_type) FROM aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
  WHERE a.grantee=(SELECT oid FROM pg_roles WHERE rolname='rebatehq_app'))=ARRAY['INSERT','SELECT']::text[]
  AND NOT EXISTS(SELECT 1 FROM aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee IN (0,(SELECT oid FROM pg_roles WHERE rolname='anon'),(SELECT oid FROM pg_roles WHERE rolname='authenticated'))) AS ok
 FROM pg_class c WHERE c.oid IN ('public.relay_pack_wrap'::regclass,'public.relay_pack_version'::regclass)) x),
 'S2 pack tables: the app role may only SELECT and INSERT; PUBLIC, anon and authenticated get nothing');

-- The Owner signs a format 2 epoch over the current roster (devices A and R), wraps the workspace key for both, the
-- book pack for both and the cost pack for A only (a Sales Rep never holds cost).
SELECT pg_temp.use_identity('__PHASE1_RELAY_USER_A_ID__');
SET LOCAL ROLE rebatehq_app;
DO $$ DECLARE last_seq bigint; last_hash bytea; prev_hash bytea; prev_n bigint; BEGIN
 IF current_user<>'rebatehq_app' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'S2 unsafe epoch role'; END IF;
 SELECT sequence,content_hash INTO last_seq,last_hash FROM public.relay_event WHERE tenant_id='__PHASE1_RELAY_TENANT_A_ID__' ORDER BY sequence DESC LIMIT 1;
 SELECT epoch_number,content_hash INTO prev_n,prev_hash FROM public.relay_epoch WHERE tenant_id='__PHASE1_RELAY_TENANT_A_ID__' ORDER BY epoch_number DESC LIMIT 1;
 INSERT INTO public.relay_epoch(id,tenant_id,epoch_number,previous_hash,base_sequence,base_hash,signer_user,signer_device,device_ids,member_roles,signature,content_hash,signed_at,format,grid)
 SELECT '__PHASE1_SHARE_EPOCH_A3_ID__','__PHASE1_RELAY_TENANT_A_ID__',prev_n+1,prev_hash,COALESCE(last_seq,0),COALESCE(last_hash,decode(repeat('00',32),'hex')),
  '__PHASE1_RELAY_USER_A_ID__','__PHASE1_RELAY_DEVICE_A_ID__',array_agg(k.id ORDER BY k.id),array_agg(m.role::text ORDER BY k.id),decode(repeat('d1',64),'hex'),decode(repeat('e1',32),'hex'),now(),2,current_setting('app.share_grid')::jsonb
 FROM public.relay_device_key k JOIN public.membership m ON m.tenant_id=k.tenant_id AND m.user_id=k.user_id JOIN public.licence_device d ON d.tenant_id=k.tenant_id AND d.id=k.id
 WHERE k.tenant_id='__PHASE1_RELAY_TENANT_A_ID__' AND d.status='active' AND m.status='active';
 INSERT INTO public.relay_key_wrap(id,tenant_id,epoch_id,recipient_device,ephemeral_public,iv,ciphertext)
 SELECT gen_random_uuid(),'__PHASE1_RELAY_TENANT_A_ID__','__PHASE1_SHARE_EPOCH_A3_ID__',x,decode('04'||repeat('a1',64),'hex'),decode(repeat('b1',12),'hex'),decode(repeat('c1',48),'hex')
 FROM unnest((SELECT device_ids FROM public.relay_epoch WHERE id='__PHASE1_SHARE_EPOCH_A3_ID__')) x;
 INSERT INTO public.relay_pack_wrap(id,tenant_id,epoch_id,pack,recipient_device,ephemeral_public,iv,ciphertext)
 SELECT gen_random_uuid(),'__PHASE1_RELAY_TENANT_A_ID__','__PHASE1_SHARE_EPOCH_A3_ID__','book',x,decode('04'||repeat('a2',64),'hex'),decode(repeat('b2',12),'hex'),decode(repeat('c2',48),'hex')
 FROM unnest((SELECT device_ids FROM public.relay_epoch WHERE id='__PHASE1_SHARE_EPOCH_A3_ID__')) x;
 INSERT INTO public.relay_pack_wrap(id,tenant_id,epoch_id,pack,recipient_device,ephemeral_public,iv,ciphertext)
 VALUES(gen_random_uuid(),'__PHASE1_RELAY_TENANT_A_ID__','__PHASE1_SHARE_EPOCH_A3_ID__','cost','__PHASE1_RELAY_DEVICE_A_ID__',decode('04'||repeat('a3',64),'hex'),decode(repeat('b3',12),'hex'),decode(repeat('c3',48),'hex'));
END $$;
RESET ROLE;
SELECT extensions.ok(true,'S2: positive format 2 epoch, workspace and pack wraps by the grid Owner under the non-bypass role');

SELECT pg_temp.use_identity('__PHASE1_RELAY_USER_A_ID__');
SET LOCAL ROLE rebatehq_app;
DO $$ BEGIN
 IF current_user<>'rebatehq_app' THEN RAISE EXCEPTION 'S2 unsafe publish role'; END IF;
 INSERT INTO public.relay_pack_version(id,tenant_id,epoch_id,pack,version,previous_hash,kind,base_version,sender_user,sender_device,iv,ciphertext,ciphertext_bytes,signature,content_hash,signed_at)
 VALUES('__PHASE1_SHARE_COST_V1_ID__','__PHASE1_RELAY_TENANT_A_ID__','__PHASE1_SHARE_EPOCH_A3_ID__','cost',1,decode(repeat('00',32),'hex'),'snapshot',0,'__PHASE1_RELAY_USER_A_ID__','__PHASE1_RELAY_DEVICE_A_ID__',decode(repeat('f1',12),'hex'),decode(repeat('f2',40),'hex'),40,decode(repeat('f3',64),'hex'),decode(repeat('f4',32),'hex'),now()),
       ('__PHASE1_SHARE_BOOK_V1_ID__','__PHASE1_RELAY_TENANT_A_ID__','__PHASE1_SHARE_EPOCH_A3_ID__','book',1,decode(repeat('00',32),'hex'),'snapshot',0,'__PHASE1_RELAY_USER_A_ID__','__PHASE1_RELAY_DEVICE_A_ID__',decode(repeat('f5',12),'hex'),decode(repeat('f6',40),'hex'),40,decode(repeat('f7',64),'hex'),decode(repeat('f8',32),'hex'),now());
END $$;
RESET ROLE;
SELECT extensions.ok(true,'S2: a grid publisher appends the first version of the cost and book packs');

SELECT pg_temp.use_identity('__PHASE1_RELAY_USER_R_ID__');
SET LOCAL ROLE rebatehq_app;
DO $$ DECLARE n integer; BEGIN
 IF current_user<>'rebatehq_app' THEN RAISE EXCEPTION 'S2 unsafe rep role'; END IF;
 SELECT count(*) INTO n FROM public.relay_pack_version WHERE tenant_id='__PHASE1_RELAY_TENANT_A_ID__' AND pack='cost';IF n<>0 THEN RAISE EXCEPTION 'S2 a rep selected cost pack rows'; END IF;
 SELECT count(*) INTO n FROM public.relay_pack_version WHERE tenant_id='__PHASE1_RELAY_TENANT_A_ID__' AND pack='book';IF n<>1 THEN RAISE EXCEPTION 'S2 a rep cannot select the book pack (%)',n; END IF;
 SELECT count(*) INTO n FROM public.relay_pack_wrap WHERE tenant_id='__PHASE1_RELAY_TENANT_A_ID__' AND epoch_id='__PHASE1_SHARE_EPOCH_A3_ID__';IF n<>3 THEN RAISE EXCEPTION 'S2 members must read every pack wrap to verify the epoch (%)',n; END IF;
END $$;
RESET ROLE;
SELECT extensions.ok(true,'S2 decision 16: a rep device selects no cost pack row but reads the book pack and every wrap');

SELECT pg_temp.use_identity('__PHASE1_RELAY_USER_R_ID__');
SET LOCAL ROLE rebatehq_app;
DO $$ DECLARE msg text; BEGIN
 BEGIN
  INSERT INTO public.relay_pack_version(id,tenant_id,epoch_id,pack,version,previous_hash,kind,base_version,sender_user,sender_device,iv,ciphertext,ciphertext_bytes,signature,content_hash,signed_at)
  VALUES(gen_random_uuid(),'__PHASE1_RELAY_TENANT_A_ID__','__PHASE1_SHARE_EPOCH_A3_ID__','book',2,decode(repeat('f8',32),'hex'),'delta',1,'__PHASE1_RELAY_USER_R_ID__','__PHASE1_RELAY_DEVICE_R_ID__',decode(repeat('f5',12),'hex'),decode(repeat('f6',40),'hex'),40,decode(repeat('f7',64),'hex'),decode(repeat('f9',32),'hex'),now());
  RAISE EXCEPTION 'S2 a rep published a pack';
 EXCEPTION WHEN check_violation THEN GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;IF position('invalid pack publisher' in msg)=0 THEN RAISE EXCEPTION 'S2 wrong rep denial %',msg; END IF;
 END;
END $$;
RESET ROLE;
SELECT extensions.ok(true,'S2: a holder of the pack who is not a grid publisher cannot append a version');

SELECT pg_temp.use_identity('__PHASE1_RELAY_USER_B_ID__');
SET LOCAL ROLE rebatehq_app;
DO $$ DECLARE n integer; BEGIN
 SELECT count(*) INTO n FROM public.relay_pack_wrap WHERE tenant_id='__PHASE1_RELAY_TENANT_A_ID__';IF n<>0 THEN RAISE EXCEPTION 'S2 cross-tenant pack wrap leaked'; END IF;
 SELECT count(*) INTO n FROM public.relay_pack_version WHERE tenant_id='__PHASE1_RELAY_TENANT_A_ID__';IF n<>0 THEN RAISE EXCEPTION 'S2 cross-tenant pack version leaked'; END IF;
END $$;
RESET ROLE;
SELECT pg_temp.use_identity('');
SET LOCAL ROLE rebatehq_app;
DO $$ DECLARE n integer; BEGIN
 SELECT count(*) INTO n FROM public.relay_pack_version;IF n<>0 THEN RAISE EXCEPTION 'S2 no-context pack version leaked'; END IF;
 SELECT count(*) INTO n FROM public.relay_pack_wrap;IF n<>0 THEN RAISE EXCEPTION 'S2 no-context pack wrap leaked'; END IF;
END $$;
RESET ROLE;
SELECT extensions.ok(true,'S2: another tenant and a missing context see no pack wrap or version');

SELECT pg_temp.use_identity('');
SELECT extensions.ok((SELECT count(*)>=5 AND bool_and(before IS NULL AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(after) k)=ARRAY['id','tenant_id']) FROM public.audit_log
 WHERE tenant_id='__PHASE1_RELAY_TENANT_A_ID__' AND entity_type IN ('relay_pack_wrap','relay_pack_version')),
 'S2: pack wraps and versions are audited as metadata only (no key, ciphertext or pack name copied)');

-- The signed roles must match membership: R (a rep) claimed as an Owner is refused; and no step back to format 1.
SELECT pg_temp.use_identity('__PHASE1_RELAY_USER_A_ID__');
SET LOCAL ROLE rebatehq_app;
DO $$ DECLARE msg text; e public.relay_epoch%ROWTYPE; BEGIN
 SELECT * INTO e FROM public.relay_epoch WHERE id='__PHASE1_SHARE_EPOCH_A3_ID__';
 BEGIN
  INSERT INTO public.relay_epoch(id,tenant_id,epoch_number,previous_hash,base_sequence,base_hash,signer_user,signer_device,device_ids,member_roles,signature,content_hash,signed_at,format,grid)
  VALUES(gen_random_uuid(),e.tenant_id,e.epoch_number+1,e.content_hash,e.base_sequence,e.base_hash,e.signer_user,e.signer_device,e.device_ids,e.member_roles,e.signature,decode(repeat('e2',32),'hex'),now(),2,
   jsonb_set(e.grid,'{people,1,role}','"owner"'));
  RAISE EXCEPTION 'S2 a rep was signed in as an Owner';
 EXCEPTION WHEN check_violation THEN GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;IF position('does not match membership' in msg)=0 THEN RAISE EXCEPTION 'S2 wrong grid denial %',msg; END IF;
 END;
 BEGIN
  INSERT INTO public.relay_epoch(id,tenant_id,epoch_number,previous_hash,base_sequence,base_hash,signer_user,signer_device,device_ids,member_roles,signature,content_hash,signed_at)
  VALUES(gen_random_uuid(),e.tenant_id,e.epoch_number+1,e.content_hash,e.base_sequence,e.base_hash,e.signer_user,e.signer_device,e.device_ids,e.member_roles,e.signature,decode(repeat('e3',32),'hex'),now());
  RAISE EXCEPTION 'S2 a format 1 epoch followed a grid';
 EXCEPTION WHEN check_violation THEN GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;IF position('sharing grid required' in msg)=0 THEN RAISE EXCEPTION 'S2 wrong downgrade denial %',msg; END IF;
 END;
END $$;
RESET ROLE;
SELECT extensions.ok(true,'S2: a grid that does not match membership, and a step back to keys without a grid, are refused');

-- Constraint probes as the operator.
DO $$ DECLARE r jsonb; BEGIN
 SELECT to_jsonb(v) INTO r FROM public.relay_pack_version v WHERE id='__PHASE1_SHARE_BOOK_V1_ID__';
 BEGIN INSERT INTO public.relay_pack_version SELECT (jsonb_populate_record(NULL::public.relay_pack_version,r||jsonb_build_object('id',gen_random_uuid(),'pack','invoices'))).*;RAISE EXCEPTION 'S2 unknown pack accepted';EXCEPTION WHEN check_violation THEN NULL;END;
 BEGIN INSERT INTO public.relay_pack_version SELECT (jsonb_populate_record(NULL::public.relay_pack_version,r||jsonb_build_object('id',gen_random_uuid(),'version',2,'kind','snapshot','base_version',1))).*;RAISE EXCEPTION 'S2 snapshot with a base accepted';EXCEPTION WHEN check_violation THEN NULL;END;
 SELECT to_jsonb(w) INTO r FROM public.relay_pack_wrap w WHERE tenant_id='__PHASE1_RELAY_TENANT_A_ID__' AND pack='cost' LIMIT 1;
 BEGIN INSERT INTO public.relay_pack_wrap SELECT (jsonb_populate_record(NULL::public.relay_pack_wrap,r||jsonb_build_object('id',gen_random_uuid(),'ciphertext',decode(repeat('aa',47),'hex')))).*;RAISE EXCEPTION 'S2 short pack key accepted';EXCEPTION WHEN check_violation THEN NULL;END;
END $$;
SELECT extensions.ok(true,'S2: pack names, snapshot bases and wrapped pack key sizes enforced by constraints');
