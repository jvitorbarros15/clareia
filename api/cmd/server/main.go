// Command server is the read-only public API. It connects as the read-only role and listens on 127.0.0.1 only.
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jvitorbarros15/clareia/api/internal/server"
)

// version is set at build time: go build -ldflags "-X main.version=<v>". It goes into every ETag.
var version = "dev"

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() error {
	dsn := os.Getenv("CLAREIA_API_RO_DSN")
	if dsn == "" {
		return errors.New("defina CLAREIA_API_RO_DSN (DSN do papel clareia_api_ro)")
	}
	port := os.Getenv("CLAREIA_API_PORT")
	if port == "" {
		port = "8787"
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return errors.New("CLAREIA_API_RO_DSN inválido")
	}
	cfg.MaxConns = 10
	cfg.MaxConnLifetime = time.Hour
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return errors.New("não foi possível criar o pool")
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		return errors.New("não foi possível conectar ao banco")
	}
	ln, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", port))
	if err != nil {
		return err
	}
	srv := &http.Server{
		Handler:           server.New(pool, version),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    16 << 10,
	}
	go func() {
		<-ctx.Done()
		sctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(sctx)
	}()
	fmt.Printf("escutando em %s (versão %s)\n", ln.Addr(), version)
	if err := srv.Serve(ln); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
