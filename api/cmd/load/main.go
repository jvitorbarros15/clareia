package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/jvitorbarros15/clareia/api/internal/loader"
)

func main() {
	revoke := flag.String("revoke", "", "revoga a publicação <id>: apaga o schema; recusa se estiver ativa")
	rollback := flag.Bool("rollback", false, "volta para a publicação anterior; recusa se ela foi revogada")
	flag.Parse()
	if err := run(*revoke, *rollback, flag.Args()); err != nil {
		fmt.Fprintln(os.Stderr, "erro:", err)
		os.Exit(1)
	}
}

func run(revoke string, rollback bool, args []string) error {
	dsn := os.Getenv("CLAREIA_API_DSN")
	if dsn == "" {
		return fmt.Errorf("CLAREIA_API_DSN não definido")
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		return err
	}
	defer conn.Close(ctx)
	opts := loader.Options{RoleName: os.Getenv("CLAREIA_API_RO_ROLE"), RolePassword: os.Getenv("CLAREIA_API_RO_PASSWORD"), Out: os.Stdout}

	switch {
	case revoke != "":
		if err := loader.Revoke(ctx, conn, revoke); err != nil {
			return err
		}
		fmt.Printf("publicação %s revogada\n", revoke)
		return nil
	case rollback:
		id, err := loader.Rollback(ctx, conn, opts)
		if err != nil {
			return err
		}
		fmt.Printf("publicação ativa agora: %s\n", id)
		return nil
	}
	if len(args) != 1 {
		return fmt.Errorf("uso: load [--revoke <id> | --rollback | <pasta da publicação>]")
	}
	start := time.Now()
	rep, err := loader.Load(ctx, conn, args[0], opts)
	if rep != nil {
		for _, r := range rep.Results {
			mark := "ok    "
			if !r.OK {
				mark = "FALHOU"
			}
			fmt.Printf("%s %s: %s\n", mark, r.Name, r.Detail)
		}
	}
	if err != nil {
		return err
	}
	if rep.Skipped != "" {
		fmt.Printf("pub_%s: %s\n", rep.FolderID, rep.Skipped)
		return nil
	}
	fmt.Printf("pub_%s ativa em %s\n", rep.FolderID, time.Since(start).Round(time.Millisecond))
	return nil
}
