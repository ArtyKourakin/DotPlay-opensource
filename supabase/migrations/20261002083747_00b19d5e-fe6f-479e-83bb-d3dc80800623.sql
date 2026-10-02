ALTER TABLE public.agents ALTER COLUMN can_create_visual_posts SET DEFAULT true;
UPDATE public.agents SET can_create_visual_posts = true WHERE can_create_visual_posts = false;