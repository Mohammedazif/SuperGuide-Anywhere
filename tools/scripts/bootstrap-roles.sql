CREATE ROLE sga_migrator LOGIN PASSWORD 'local-dev-only';
CREATE ROLE sga_app LOGIN PASSWORD 'local-dev-only' NOBYPASSRLS;
GRANT CONNECT ON DATABASE superguide_anywhere TO sga_migrator, sga_app;
GRANT CREATE ON DATABASE superguide_anywhere TO sga_migrator;
ALTER DEFAULT PRIVILEGES FOR ROLE sga_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sga_app;
ALTER DEFAULT PRIVILEGES FOR ROLE sga_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO sga_app;
GRANT USAGE ON SCHEMA public TO sga_migrator, sga_app;
GRANT CREATE ON SCHEMA public TO sga_migrator;
