# Database backup

Every night at 03:17 UTC the **Database backup** workflow (`.github/workflows/db-backup.yml`)
dumps the Supabase database (`public`, `auth` and `storage` schemas), encrypts the file with
AES-256 and keeps it for 30 days as a workflow artifact. The repository is public: the file is
useless without the passphrase. It can also be started by hand from the Actions tab.

Pictures in Supabase Storage are files, not rows: they are not in the dump.

## Setup (once)

1. In Supabase: **Connect** (top of the project page) → **Session pooler** → copy the URI and
   put the database password in place of `[YOUR-PASSWORD]`. Use the session pooler: the direct
   connection only works over IPv6, which GitHub runners do not have.
2. In GitHub: **Settings → Secrets and variables → Actions → New repository secret**
   - `SUPABASE_DB_URL`: the URI from step 1
   - `BACKUP_PASSPHRASE`: a long passphrase. Keep a copy in a password manager: without it
     the backups cannot be opened.
3. **Actions → Database backup → Run workflow** to check it works.

## Restore

1. Download the artifact from the run (Actions → Database backup → the run → Artifacts) and unzip it.
2. Decrypt: `gpg --decrypt --output backup.dump truemaquiz-YYYY-MM-DD.dump.gpg` (asks for the passphrase).
3. Look inside without touching anything: `pg_restore --list backup.dump`
4. Restore one table into the database, for example the quizzes:
   `pg_restore --dbname "<session pooler URI>" --data-only --table=quizzes backup.dump`
   A full restore over a live project overwrites data: do it on a new project, or ask first.
