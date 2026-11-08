PORT ?= 3000

.DEFAULT_GOAL := help
.PHONY: help run check

help: ## Show the available commands
	@grep -E '^[a-z]+:.*##' $(MAKEFILE_LIST) | awk -F ':.*## ' '{printf "  make %-8s %s\n", $$1, $$2}'

run: ## Start the app (make run PORT=8080 to change the port)
	PORT=$(PORT) node server.js

check: ## Check the code and every file in books/
	node --check server.js
	node --check public/app.js
	node server.js --check
