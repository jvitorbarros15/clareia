package loader

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

const DefaultRole = "clareia_api_ro"

// EnsureBase creates the api schema and the state table, and checks that the read-only role exists.
func EnsureBase(ctx context.Context, conn *pgx.Conn, o Options) error {
	if _, err := conn.Exec(ctx, ddlAPI); err != nil {
		return err
	}
	var exists bool
	if err := conn.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1)`, roleOf(o)).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return fmt.Errorf("papel %s não existe: rode load --setup uma vez", roleOf(o))
	}
	return nil
}

// Setup creates or resets the read-only role and closes what PUBLIC leaves open. Run once, by a superuser, not on every load.
func Setup(ctx context.Context, conn *pgx.Conn, o Options) error {
	if o.RolePassword == "" {
		return errors.New("senha do papel somente-leitura não informada")
	}
	if _, err := conn.Exec(ctx, ddlAPI); err != nil {
		return err
	}
	role := roleOf(o)
	var exists bool
	if err := conn.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1)`, role).Scan(&exists); err != nil {
		return err
	}
	verb := "CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD %L"
	if exists {
		verb = "ALTER ROLE %I NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD %L"
	}
	steps := []string{
		verb,
		"ALTER ROLE %I SET default_transaction_read_only = on",
		"ALTER ROLE %I SET statement_timeout = '15s'",
	}
	for _, s := range steps {
		var stmt string
		if err := conn.QueryRow(ctx, `SELECT format($1, $2::text, $3::text)`, s, role, o.RolePassword).Scan(&stmt); err != nil {
			return err
		}
		if _, err := conn.Exec(ctx, stmt); err != nil {
			return err
		}
	}
	var grants string
	err := conn.QueryRow(ctx, `SELECT format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC; REVOKE ALL ON DATABASE %I FROM %I; GRANT CONNECT ON DATABASE %I TO %I; `+
		`REVOKE CONNECT ON DATABASE postgres, template1 FROM PUBLIC; `+
		`REVOKE EXECUTE ON FUNCTION lo_create(oid), lo_creat(integer), lo_from_bytea(oid, bytea) FROM PUBLIC',
		current_database(), current_database(), $1::text, current_database(), $1::text)`, role).Scan(&grants)
	if err != nil {
		return err
	}
	_, err = conn.Exec(ctx, grants)
	return err
}

func roleOf(o Options) string {
	if o.RoleName == "" {
		return DefaultRole
	}
	return o.RoleName
}

// activate points the api views at pub_<id> and records the states, in one transaction. The old previous is dropped.
func activate(ctx context.Context, conn *pgx.Conn, pub *Publication, o Options) error {
	tx, err := conn.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := repoint(ctx, tx, pub.FolderID, o); err != nil {
		return err
	}
	var old []string
	rows, err := tx.Query(ctx, `SELECT folder_id FROM api.publications WHERE state = 'previous' AND folder_id <> $1`, pub.FolderID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		old = append(old, id)
	}
	rows.Close()
	for _, id := range old {
		if _, err := tx.Exec(ctx, `DROP SCHEMA IF EXISTS `+schemaOf(id)+` CASCADE`); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE api.publications SET state = 'retired' WHERE folder_id = $1`, id); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE api.publications SET state = 'previous' WHERE state = 'active' AND folder_id <> $1`, pub.FolderID); err != nil {
		return err
	}
	tag, err := tx.Exec(ctx, `INSERT INTO api.publications (folder_id, state, expenses_version, activated_at) VALUES ($1, 'active', $2, now())
		ON CONFLICT (folder_id) DO UPDATE SET state = 'active', activated_at = now() WHERE api.publications.state NOT IN ('revoked', 'retired')`, pub.FolderID, pub.Summary.PublicationID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return fmt.Errorf("publicação %s não pôde ser ativada (revogada ou substituída)", pub.FolderID)
	}
	return tx.Commit(ctx)
}

func repoint(ctx context.Context, tx pgx.Tx, id string, o Options) error {
	for _, t := range apiTables {
		// DROP + CREATE, not CREATE OR REPLACE: a publication with other columns or column order must still activate.
		if _, err := tx.Exec(ctx, fmt.Sprintf(`DROP VIEW IF EXISTS api.%s; CREATE VIEW api.%s AS SELECT * FROM %s.%s`, t, t, schemaOf(id), t)); err != nil {
			return fmt.Errorf("view api.%s: %w", t, err)
		}
	}
	var stmt string
	err := tx.QueryRow(ctx, `SELECT format('GRANT USAGE ON SCHEMA api TO %I; GRANT SELECT ON api.expenses, api.deputies, api.deputy_months, api.deputy_categories, api.supplier_cells, api.suppliers, api.publication TO %I', $1::text, $1::text)`, roleOf(o)).Scan(&stmt)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, stmt)
	return err
}

// Revoke drops the schema of a publication that is not active and keeps a tombstone so it cannot be loaded again.
func Revoke(ctx context.Context, conn *pgx.Conn, id string) error {
	if !folderIDPattern.MatchString(id) {
		return fmt.Errorf("id %q não é uma publicação (12 hex)", id)
	}
	if _, err := conn.Exec(ctx, ddlAPI); err != nil {
		return err
	}
	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock($1)`, lockKey); err != nil {
		return err
	}
	defer conn.Exec(context.Background(), `SELECT pg_advisory_unlock($1)`, lockKey)
	tx, err := conn.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var state string
	err = tx.QueryRow(ctx, `SELECT state FROM api.publications WHERE folder_id = $1`, id).Scan(&state)
	if err != nil && err != pgx.ErrNoRows {
		return err
	}
	if state == "active" {
		return fmt.Errorf("publicação %s está ativa: ative outra antes de revogar", id)
	}
	if _, err := tx.Exec(ctx, `DROP SCHEMA IF EXISTS `+schemaOf(id)+` CASCADE`); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO api.publications (folder_id, state, revoked_at) VALUES ($1, 'revoked', now())
		ON CONFLICT (folder_id) DO UPDATE SET state = 'revoked', revoked_at = now()`, id); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// Rollback makes the previous publication active and the active one previous.
func Rollback(ctx context.Context, conn *pgx.Conn, o Options) (string, error) {
	if _, err := conn.Exec(ctx, ddlAPI); err != nil {
		return "", err
	}
	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock($1)`, lockKey); err != nil {
		return "", err
	}
	defer conn.Exec(context.Background(), `SELECT pg_advisory_unlock($1)`, lockKey)
	tx, err := conn.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	var prev string
	if err := tx.QueryRow(ctx, `SELECT folder_id FROM api.publications WHERE state = 'previous'`).Scan(&prev); err != nil {
		if err == pgx.ErrNoRows {
			return "", errors.New("não há publicação anterior para voltar (ausente ou revogada)")
		}
		return "", err
	}
	if err := ensureSuppliersTx(ctx, tx, prev, nil, o); err != nil {
		return "", fmt.Errorf("tabela suppliers de pub_%s: %w", prev, err)
	}
	if err := repoint(ctx, tx, prev, o); err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, `UPDATE api.publications SET state = CASE state WHEN 'active' THEN 'previous' ELSE 'active' END, activated_at = CASE state WHEN 'previous' THEN now() ELSE activated_at END WHERE state IN ('active', 'previous')`); err != nil {
		return "", err
	}
	return prev, tx.Commit(ctx)
}
