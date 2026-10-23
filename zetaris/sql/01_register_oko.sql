-- Register PostgreSQL JDBC datasource in Zetaris
CREATE DATASOURCE oko_pg DESCRIBE BY 'Oko Farm Agent Postgres Database' OPTIONS (
  jdbcdriver 'org.postgresql.Driver',
  jdbcurl 'jdbc:postgresql://${OKO_PG_HOST}:${OKO_PG_PORT}/${OKO_PG_DB}',
  username '${OKO_PG_USER}',
  password '${OKO_PG_PASSWORD}',
  fetchsize '1000'
);

-- Register all tables discovered from the PostgreSQL datasource
REGISTER DATASOURCE TABLES FROM oko_pg;
