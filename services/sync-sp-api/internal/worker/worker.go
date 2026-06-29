package worker

// Worker is the Temporal activity/workflow host for SP-API sync jobs.
type Worker struct{}

func New() *Worker {
	return &Worker{}
}
