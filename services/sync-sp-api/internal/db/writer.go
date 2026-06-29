package db

// Writer handles all writes to PostgreSQL from the SP-API sync process.
type Writer struct {
	dsn string
}

func NewWriter(dsn string) *Writer {
	return &Writer{dsn: dsn}
}
