#!/usr/bin/env node
/**
 * Entry point for the vesk language server CLI (`vesk-lsp`).
 */

import { createVeskLanguageServer } from './server';

createVeskLanguageServer();