package loader

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
)

var folderIDPattern = regexp.MustCompile(`^[0-9a-f]{12}$`)

type MonthSummary struct {
	Month       int      `json:"month"`
	Cents       int64    `json:"cents"`
	Records     int      `json:"records"`
	Exercise    *string  `json:"exercise"`
	PartyStatus string   `json:"partyStatus"`
	Party       *string  `json:"party"`
	PartyValues []string `json:"partyValues"`
	UFStatus    string   `json:"ufStatus"`
	UF          *string  `json:"uf"`
	Held        bool     `json:"held"`
}

type CategorySummary struct {
	Category string `json:"category"`
	Cents    int64  `json:"cents"`
	Records  int    `json:"records"`
}

type PersonSummary struct {
	ID                 int               `json:"id"`
	Name               string            `json:"name"`
	Photo              *string           `json:"photo"`
	Cents              int64             `json:"cents"`
	Records            int               `json:"records"`
	Months             []MonthSummary    `json:"months"`
	Categories         []CategorySummary `json:"categories"`
	ExercisedMonths    int               `json:"exercisedMonths"`
	NoExercise         bool              `json:"noExercise"`
	HeldMonths         []int             `json:"heldMonths"`
	Comparable         bool              `json:"comparable"`
	Party              *string           `json:"party"`
	PartyNote          *string           `json:"partyNote"`
	PartyInReview      bool              `json:"partyInReview"`
	LastConfirmedParty *string           `json:"lastConfirmedParty"`
}

type Summary struct {
	Schema        string          `json:"schema"`
	PublicationID string          `json:"publicationId"`
	Ceiling       json.RawMessage `json:"ceiling"`
	Scope         struct {
		IDs []int `json:"ids"`
	} `json:"scope"`
	MinMonths  int             `json:"minMonths"`
	TotalCents int64           `json:"totalCents"`
	Records    int             `json:"records"`
	Categories []string        `json:"categories"`
	People     []PersonSummary `json:"people"`
}

type IndexPerson struct {
	ID        int     `json:"id"`
	UF        *string `json:"uf"`
	UFNote    *string `json:"ufNote"`
	Party     *string `json:"party"`
	SourceURL *string `json:"sourceUrl"`
}

type HeldCompetence struct {
	Month    int      `json:"month"`
	Reasons  []string `json:"reasons"`
	PersonID int      `json:"personId"`
}

type Index struct {
	People      []IndexPerson   `json:"people"`
	WithoutData []int           `json:"withoutData"`
	PublishedAt string          `json:"publishedAt"`
	Validation  json.RawMessage `json:"validation"`
}

type Validation struct {
	HeldCompetences []HeldCompetence `json:"heldCompetences"`
	HeldMonths      map[string]int   `json:"heldMonths"`
	TotalCents      int64            `json:"totalCents"`
	RecordCount     int              `json:"recordCount"`
	Limitations     json.RawMessage  `json:"limitations"`
}

type Suppliers struct {
	Schema        string                `json:"schema"`
	PublicationID string                `json:"publicationId"`
	Categories    []string              `json:"categories"`
	Suppliers     []string              `json:"suppliers"`
	People        map[string][][5]int64 `json:"people"`
}

type Publication struct {
	FolderID      string
	Dir           string
	Summary       Summary
	Index         Index
	Validation    Validation
	Suppliers     Suppliers
	DomainVersion json.RawMessage
}

func readJSON(path string, v any) error {
	b, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(b, v); err != nil {
		return fmt.Errorf("%s: %w", filepath.Base(path), err)
	}
	return nil
}

// Read loads the small files of one publication folder. The records are streamed later, one deputy at a time.
func Read(dir string) (*Publication, error) {
	dir, err := filepath.Abs(dir)
	if err != nil {
		return nil, err
	}
	p := &Publication{Dir: dir, FolderID: filepath.Base(dir)}
	if !folderIDPattern.MatchString(p.FolderID) {
		return nil, fmt.Errorf("nome de pasta %q não é um id de publicação (12 hex)", p.FolderID)
	}
	if err := readJSON(filepath.Join(dir, "summary.json"), &p.Summary); err != nil {
		return nil, err
	}
	if err := readJSON(filepath.Join(dir, "index.json"), &p.Index); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(p.Index.Validation, &p.Validation); err != nil {
		return nil, fmt.Errorf("index.json validation: %w", err)
	}
	if err := readJSON(filepath.Join(dir, "fornecedores.json"), &p.Suppliers); err != nil {
		return nil, err
	}
	p.DomainVersion = domainVersions(dir, p.FolderID)
	return p, nil
}

// The site manifest sits two levels up (<site>/manifest.json, base data/<id>); a lone folder has none.
func domainVersions(dir, id string) json.RawMessage {
	var m struct {
		Base    string `json:"base"`
		Domains map[string]struct {
			Version string `json:"version"`
		} `json:"domains"`
	}
	if readJSON(filepath.Join(dir, "..", "..", "manifest.json"), &m) != nil || m.Base != "data/"+id {
		return json.RawMessage(`{}`)
	}
	out := map[string]string{}
	for k, v := range m.Domains {
		out[k] = v.Version
	}
	b, _ := json.Marshal(out)
	return b
}

type record struct {
	ID               string  `json:"id"`
	Month            int     `json:"month"`
	Category         string  `json:"category"`
	PersonID         int     `json:"personId"`
	Cents            int64   `json:"cents"`
	SupplierVerified bool    `json:"supplierVerified"`
	SupplierKey      *string `json:"supplierKey"`
}

// readRecords returns each record's raw bytes plus the fields used for filtering. ok is false when the deputy has no folder.
func (p *Publication) readRecords(id int) (raws []json.RawMessage, fields []record, ok bool, err error) {
	b, err := os.ReadFile(filepath.Join(p.Dir, "deputados", fmt.Sprint(id), "despesas.json"))
	if os.IsNotExist(err) {
		return nil, nil, false, nil
	}
	if err != nil {
		return nil, nil, false, err
	}
	if err := json.Unmarshal(b, &raws); err != nil {
		return nil, nil, false, fmt.Errorf("despesas de %d: %w", id, err)
	}
	fields = make([]record, len(raws))
	for i, raw := range raws {
		if err := json.Unmarshal(raw, &fields[i]); err != nil {
			return nil, nil, false, fmt.Errorf("despesas de %d, posição %d: %w", id, i, err)
		}
		if fields[i].PersonID != id {
			return nil, nil, false, fmt.Errorf("despesas de %d, posição %d: registro é de %d", id, i, fields[i].PersonID)
		}
	}
	return raws, fields, true, nil
}
