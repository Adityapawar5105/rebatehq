-- Stand-in for the Supabase-managed Storage schema (team sharing S3), for PGlite harnesses that apply every migration:
-- only what 20261126120000_sharing_s3_storage.sql touches. Real Storage runs in CI's local Supabase and the relay gate.
CREATE SCHEMA storage;
CREATE TABLE storage.buckets(id text PRIMARY KEY,name text NOT NULL,public boolean DEFAULT false,file_size_limit bigint,allowed_mime_types text[]);
CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text REFERENCES storage.buckets(id),name text,owner uuid,metadata jsonb);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA storage TO authenticated;
GRANT SELECT,INSERT ON storage.objects TO authenticated;
-- Stand-in for the Supabase-managed Realtime objects team sharing S4 uses: the broadcast table, the topic the server sets
-- while checking a join, and send(), which (like the real one) only warns when it cannot write.
CREATE SCHEMA realtime;
CREATE TABLE realtime.messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),topic text NOT NULL,extension text NOT NULL,payload jsonb,event text,private boolean DEFAULT false,inserted_at timestamptz DEFAULT now());
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION realtime.topic() RETURNS text LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('realtime.topic',true),'')::text$$;
CREATE FUNCTION realtime.send(payload jsonb,event text,topic text,private boolean DEFAULT true) RETURNS void LANGUAGE plpgsql AS $$
DECLARE id uuid:=gen_random_uuid();
BEGIN
 BEGIN
  INSERT INTO realtime.messages(id,payload,event,topic,private,extension) VALUES(id,payload||jsonb_build_object('id',id),event,topic,private,'broadcast');
 EXCEPTION WHEN OTHERS THEN RAISE WARNING 'WarnSendingBroadcastMessage: %',SQLERRM;
 END;
END $$;
GRANT USAGE ON SCHEMA realtime TO authenticated;
GRANT SELECT ON realtime.messages TO authenticated;
