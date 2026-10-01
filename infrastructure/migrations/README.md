The applied PostgreSQL migration is:

`services/api/prisma/migrations/20261001120000_init/migration.sql`

`prisma migrate deploy` reads that directory. This folder exists so infrastructure changes stay next to Docker Compose. Do not keep a second copy of the SQL here.
