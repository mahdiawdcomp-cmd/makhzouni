-- Update catalogPublicUrl from old Vercel URL to production domain
UPDATE settings
SET value = '"https://mahdi.mazbwoni.com/catalog"'
WHERE key = 'catalogPublicUrl'
  AND value::text LIKE '%inventory-web-six-kohl.vercel.app%';
