package loader

import (
	"context"

	"github.com/jackc/pgx/v5"
)

var RunChecks = runChecks

// BeginUnchecked inserts a publication in an open transaction without running the checks, so tests can tamper with the rows first.
func BeginUnchecked(ctx context.Context, conn *pgx.Conn, pub *Publication) (pgx.Tx, error) {
	tx, err := conn.Begin(ctx)
	if err != nil {
		return nil, err
	}
	schema := schemaOf(pub.FolderID)
	for _, q := range []string{`CREATE SCHEMA ` + schema, `SET LOCAL search_path = ` + schema, ddlPublication} {
		if _, err := tx.Exec(ctx, q); err != nil {
			tx.Rollback(ctx)
			return nil, err
		}
	}
	if err := insertAll(ctx, tx, pub, schema); err != nil {
		tx.Rollback(ctx)
		return nil, err
	}
	return tx, nil
}
