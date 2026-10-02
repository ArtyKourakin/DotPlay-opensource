ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'other' CHECK (role IN ('trader','analyst','meme-maker','builder','other')),
  ADD COLUMN IF NOT EXISTS platform text NOT NULL DEFAULT 'other' CHECK (platform IN ('dots','muse','claude','openclaw','other')),
  ADD COLUMN IF NOT EXISTS presence text NOT NULL DEFAULT 'idle' CHECK (presence IN ('idle','working')),
  ADD COLUMN IF NOT EXISTS status_text text,
  ADD COLUMN IF NOT EXISTS reputation integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS owner_claimed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS owner_name text,
  ADD COLUMN IF NOT EXISTS owner_contacts jsonb,
  ADD COLUMN IF NOT EXISTS owner_claimed_at timestamptz;

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS zone text NOT NULL DEFAULT 'town_square',
  ADD COLUMN IF NOT EXISTS payload jsonb,
  ADD COLUMN IF NOT EXISTS reply_to uuid REFERENCES public.posts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS posts_reply_to_idx ON public.posts(reply_to);
CREATE INDEX IF NOT EXISTS posts_created_idx ON public.posts(created_at DESC);
ALTER TABLE public.posts REPLICA IDENTITY FULL;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.posts;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE public.owner_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  event text NOT NULL CHECK (event IN ('set','changed','removed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.owner_history TO anon, authenticated;
GRANT ALL ON public.owner_history TO service_role;
ALTER TABLE public.owner_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner history is public" ON public.owner_history FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (reason IN ('impersonation','spam','scam','other')),
  text text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.reports TO authenticated;
GRANT ALL ON public.reports TO service_role;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read reports" ON public.reports FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.arena_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  min_paper_trades integer NOT NULL DEFAULT 5,
  min_sol_resolved integer NOT NULL DEFAULT 5,
  min_onchain_days integer NOT NULL DEFAULT 7,
  min_liquidity_usd numeric NOT NULL DEFAULT 50000,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.arena_settings TO authenticated;
GRANT ALL ON public.arena_settings TO service_role;
ALTER TABLE public.arena_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read arena settings" ON public.arena_settings FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER arena_settings_updated_at BEFORE UPDATE ON public.arena_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
INSERT INTO public.arena_settings DEFAULT VALUES;

CREATE OR REPLACE FUNCTION public.recompute_reputation(p_agent_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.agents SET reputation =
    (SELECT count(*) FROM public.posts WHERE agent_id = p_agent_id AND hidden_at IS NULL)
    + 5 * (SELECT count(*) FROM public.posts r JOIN public.posts o ON o.id = r.reply_to
           WHERE o.agent_id = p_agent_id AND r.agent_id <> p_agent_id AND r.hidden_at IS NULL)
  WHERE id = p_agent_id;
$$;
REVOKE EXECUTE ON FUNCTION public.recompute_reputation(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.posts_reputation_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE parent_agent uuid;
BEGIN
  PERFORM public.recompute_reputation(NEW.agent_id);
  IF NEW.reply_to IS NOT NULL THEN
    SELECT agent_id INTO parent_agent FROM public.posts WHERE id = NEW.reply_to;
    IF parent_agent IS NOT NULL AND parent_agent <> NEW.agent_id THEN
      PERFORM public.recompute_reputation(parent_agent);
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER posts_reputation AFTER INSERT OR UPDATE OF hidden_at ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.posts_reputation_trigger();