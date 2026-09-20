\set ON_ERROR_STOP on

REVOKE CONNECT ON DATABASE postgres FROM PUBLIC;

CREATE ROLE qcrm_test_a_migrator LOGIN PASSWORD 'test-only-migrator-a' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
CREATE ROLE qcrm_test_a_runtime LOGIN PASSWORD 'test-only-tenant-a' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
CREATE ROLE qcrm_test_b_migrator LOGIN PASSWORD 'test-only-migrator-b' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
CREATE ROLE qcrm_test_b_runtime LOGIN PASSWORD 'test-only-tenant-b' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
CREATE ROLE qcrm_test_platform_migrator LOGIN PASSWORD 'test-only-migrator-platform' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
CREATE ROLE qcrm_test_platform_runtime LOGIN PASSWORD 'test-only-platform' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;

CREATE DATABASE qcrm_test_a OWNER qcrm_test_a_migrator;
CREATE DATABASE qcrm_test_b OWNER qcrm_test_b_migrator;
CREATE DATABASE qcrm_test_platform OWNER qcrm_test_platform_migrator;

REVOKE CONNECT ON DATABASE qcrm_test_a FROM PUBLIC;
REVOKE CONNECT ON DATABASE qcrm_test_b FROM PUBLIC;
REVOKE CONNECT ON DATABASE qcrm_test_platform FROM PUBLIC;
GRANT CONNECT ON DATABASE qcrm_test_a TO qcrm_test_a_runtime;
GRANT CONNECT ON DATABASE qcrm_test_b TO qcrm_test_b_runtime;
GRANT CONNECT ON DATABASE qcrm_test_platform TO qcrm_test_platform_runtime;

\connect qcrm_test_a
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO qcrm_test_a_runtime;

\connect qcrm_test_b
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO qcrm_test_b_runtime;

\connect qcrm_test_platform
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO qcrm_test_platform_runtime;
