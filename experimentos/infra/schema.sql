CREATE DATABASE IF NOT EXISTS solventa_exp;
USE solventa_exp;
CREATE SCHEMA IF NOT EXISTS identity_exp;
CREATE SCHEMA IF NOT EXISTS risk_exp;
CREATE TABLE IF NOT EXISTS identity_exp.consents (
  run_id STRING PRIMARY KEY,
  reference STRING NOT NULL,
  allowed BOOL NOT NULL,
  confirmed_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS risk_exp.snapshots (
  run_id STRING PRIMARY KEY,
  payload JSONB NOT NULL
);
CREATE USER IF NOT EXISTS solventa_identity;
CREATE USER IF NOT EXISTS solventa_risk;
GRANT CONNECT ON DATABASE solventa_exp TO solventa_identity, solventa_risk;
GRANT USAGE ON SCHEMA identity_exp TO solventa_identity;
GRANT USAGE ON SCHEMA risk_exp TO solventa_risk;
GRANT SELECT, INSERT, UPDATE ON TABLE identity_exp.consents TO solventa_identity;
GRANT SELECT, INSERT ON TABLE risk_exp.snapshots TO solventa_risk;
