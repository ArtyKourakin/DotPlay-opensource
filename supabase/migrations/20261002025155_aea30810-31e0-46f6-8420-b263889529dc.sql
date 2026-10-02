CREATE TABLE public.paper_accounts (
  agent_id uuid PRIMARY KEY REFERENCES public.agents(id) ON DELETE CASCADE,
  cash_usd numeric(20,6) NOT NULL DEFAULT 10000,
  starting_usd numeric(20,6) NOT NULL DEFAULT 10000,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.paper_positions (
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  qty numeric(30,10) NOT NULL DEFAULT 0,
  avg_price numeric(20,8) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, symbol)
);
CREATE TABLE public.paper_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  side text NOT NULL CHECK (side IN ('buy','sell')),
  qty numeric(30,10) NOT NULL,
  price numeric(20,8) NOT NULL,
  usd numeric(20,6) NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX paper_trades_agent_idx ON public.paper_trades(agent_id, created_at DESC);
CREATE INDEX paper_trades_recent_idx ON public.paper_trades(created_at DESC);

GRANT SELECT ON public.paper_accounts, public.paper_positions, public.paper_trades TO anon, authenticated;
GRANT ALL ON public.paper_accounts, public.paper_positions, public.paper_trades TO service_role;

ALTER TABLE public.paper_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paper_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paper_trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Paper accounts are public" ON public.paper_accounts FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Paper positions are public" ON public.paper_positions FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Paper trades are public" ON public.paper_trades FOR SELECT TO anon, authenticated USING (true);

CREATE TRIGGER paper_accounts_updated_at BEFORE UPDATE ON public.paper_accounts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Atomic trade execution (server only).
CREATE OR REPLACE FUNCTION public.paper_execute_trade(p_agent_id uuid, p_symbol text, p_side text, p_usd numeric, p_price numeric, p_note text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cash numeric; v_qty numeric; v_pos public.paper_positions%ROWTYPE; v_id uuid; v_usd numeric := p_usd;
BEGIN
  IF p_price IS NULL OR p_price <= 0 OR p_usd IS NULL OR p_usd <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
  INSERT INTO public.paper_accounts(agent_id) VALUES (p_agent_id) ON CONFLICT DO NOTHING;
  SELECT cash_usd INTO v_cash FROM public.paper_accounts WHERE agent_id = p_agent_id FOR UPDATE;
  SELECT * INTO v_pos FROM public.paper_positions WHERE agent_id = p_agent_id AND symbol = p_symbol FOR UPDATE;
  IF p_side = 'buy' THEN
    IF v_usd > v_cash THEN RAISE EXCEPTION 'insufficient_cash'; END IF;
    v_qty := v_usd / p_price;
    INSERT INTO public.paper_positions(agent_id, symbol, qty, avg_price) VALUES (p_agent_id, p_symbol, v_qty, p_price)
    ON CONFLICT (agent_id, symbol) DO UPDATE SET
      avg_price = CASE WHEN paper_positions.qty + EXCLUDED.qty > 0 THEN (paper_positions.qty*paper_positions.avg_price + EXCLUDED.qty*EXCLUDED.avg_price)/(paper_positions.qty + EXCLUDED.qty) ELSE EXCLUDED.avg_price END,
      qty = paper_positions.qty + EXCLUDED.qty, updated_at = now();
    UPDATE public.paper_accounts SET cash_usd = cash_usd - v_usd WHERE agent_id = p_agent_id;
  ELSIF p_side = 'sell' THEN
    IF v_pos.qty IS NULL OR v_pos.qty <= 0 THEN RAISE EXCEPTION 'no_position'; END IF;
    v_qty := LEAST(v_usd / p_price, v_pos.qty);
    v_usd := v_qty * p_price;
    UPDATE public.paper_positions SET qty = qty - v_qty, updated_at = now() WHERE agent_id = p_agent_id AND symbol = p_symbol;
    DELETE FROM public.paper_positions WHERE agent_id = p_agent_id AND symbol = p_symbol AND qty <= 0.0000000001;
    UPDATE public.paper_accounts SET cash_usd = cash_usd + v_usd WHERE agent_id = p_agent_id;
  ELSE RAISE EXCEPTION 'invalid_side'; END IF;
  INSERT INTO public.paper_trades(agent_id, symbol, side, qty, price, usd, note)
  VALUES (p_agent_id, p_symbol, p_side, v_qty, p_price, v_usd, left(p_note, 280)) RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.paper_execute_trade(uuid,text,text,numeric,numeric,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paper_execute_trade(uuid,text,text,numeric,numeric,text) TO service_role;

-- Calm activity settings and site power on.
INSERT INTO public.demo_agent_settings (global_enabled, scheduler_enabled, daily_max_requests, daily_max_posts, daily_max_comments)
SELECT true, true, 150, 30, 60 WHERE NOT EXISTS (SELECT 1 FROM public.demo_agent_settings);
UPDATE public.demo_agent_settings SET global_enabled = true, scheduler_enabled = true;
INSERT INTO public.platform_settings (live_mode) SELECT true WHERE NOT EXISTS (SELECT 1 FROM public.platform_settings);
INSERT INTO public.demo_scheduler_tokens (name, token)
SELECT 'live-agents', encode(gen_random_bytes(32), 'hex') WHERE NOT EXISTS (SELECT 1 FROM public.demo_scheduler_tokens WHERE name = 'live-agents');