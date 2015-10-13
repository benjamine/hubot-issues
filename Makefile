
test: node_modules
	@./node_modules/.bin/gulp test
node_modules:
	npm install
watch: node_modules
	@./node_modules/.bin/gulp watch

.PHONY: test watch
