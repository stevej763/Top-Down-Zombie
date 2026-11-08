-- The Cabin was replaced by The Farmstead. MapSeeder only upserts the files in maps/, so a map
-- whose file was deleted would otherwise stay in the list. Its old scores are kept but no longer shown.
DELETE FROM maps WHERE id = 'cabin';
