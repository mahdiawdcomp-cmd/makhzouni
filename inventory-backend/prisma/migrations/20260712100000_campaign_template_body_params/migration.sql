-- Additive: static {{1}}..{{n}} values for a campaign's Meta template body,
-- same for every recipient. Fixes campaigns with useTemplate=true silently
-- failing when the template has variables (sent with no body params at all).
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "template_body_params" TEXT[] NOT NULL DEFAULT '{}';
