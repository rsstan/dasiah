-- Up Migration
-- Functions called inside a view are checked against the querying role, so app_read needs
-- EXECUTE on the masking functions to read identity.v_users_masked. Both are pure functions
-- of their argument and reveal nothing that the masked view does not already show.
GRANT EXECUTE ON FUNCTION identity.mask_email(citext), identity.mask_name(text) TO app_read;

-- Down Migration
REVOKE EXECUTE ON FUNCTION identity.mask_email(citext), identity.mask_name(text) FROM app_read;
