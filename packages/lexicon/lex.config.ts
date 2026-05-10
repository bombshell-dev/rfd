import { defineLexiconConfig } from '@atcute/lex-cli';

export default defineLexiconConfig({
	generate: {
		files: ['lexicons/**/*.json'],
		outdir: 'src/lexicons/',
		modules: { importSuffix: '.ts' },
		imports: ['@atcute/atproto'],
		clean: true,
	},
});
