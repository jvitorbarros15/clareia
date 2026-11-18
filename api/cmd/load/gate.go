package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// gate runs the CPF scan and the five refusals on a folder. Load never starts without both passing.
func gate(folder string) error {
	root, err := repoRoot()
	if err != nil {
		return err
	}
	abs, err := filepath.Abs(folder)
	if err != nil {
		return err
	}
	steps := []struct {
		name string
		args []string
	}{
		{"busca de CPF", []string{"npm", "run", "scan:cpf", "--", abs}},
		{"cinco recusas", []string{"npx", "tsx", "api/scripts/check-publication.ts", abs}},
	}
	for _, s := range steps {
		fmt.Println("==", s.name)
		cmd := exec.Command(s.args[0], s.args[1:]...)
		cmd.Dir = root
		cmd.Env = withoutSecrets(os.Environ())
		cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
		if err := cmd.Run(); err != nil {
			return fmt.Errorf("%s falhou: %w", s.name, err)
		}
	}
	return nil
}

func repoRoot() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "api", "scripts", "check-publication.ts")); err == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", fmt.Errorf("raiz do repositório não encontrada a partir de %s", dir)
		}
		dir = parent
	}
}

// The Node steps never need the database credentials.
func withoutSecrets(env []string) []string {
	var out []string
	for _, e := range env {
		if !strings.HasPrefix(strings.ToUpper(e), "CLAREIA_API_") {
			out = append(out, e)
		}
	}
	return out
}
