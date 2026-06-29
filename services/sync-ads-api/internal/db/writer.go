package db

// Writer handles all writes to PostgreSQL from the Advertising API sync process.
type Writer struct {
	dsn string
}

func NewWriter(dsn string) *Writer {
	return &Writer{dsn: dsn}
}
