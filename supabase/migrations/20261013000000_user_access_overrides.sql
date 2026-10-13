-- Explicit per-user CRUD decisions override role defaults. A missing row
-- inherits the role_permissions value; super_admin authority is structural
-- in the server policy and cannot be removed here.
CREATE TABLE IF NOT EXISTS user_access_overrides (
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('create', 'read', 'update', 'delete')),
  decision TEXT NOT NULL CHECK (decision IN ('allow', 'deny')),
  updated_by UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, feature_key, operation)
);

CREATE INDEX IF NOT EXISTS user_access_overrides_user_id_idx
  ON user_access_overrides (user_id);

DROP TRIGGER IF EXISTS user_access_overrides_updated_at ON user_access_overrides;
CREATE TRIGGER user_access_overrides_updated_at
BEFORE UPDATE ON user_access_overrides
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

ALTER TABLE user_access_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_access_overrides_super_admin ON user_access_overrides;
CREATE POLICY user_access_overrides_super_admin ON user_access_overrides
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'super_admin'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'super_admin'
  ));
