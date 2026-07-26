-- Vesk filetype plugin

vim.bo.commentstring = "// %s"
vim.bo.tabstop = 2
vim.bo.shiftwidth = 2
vim.bo.softtabstop = 2
vim.bo.expandtab = true
vim.bo.smartindent = true
vim.bo.formatprg = ""

-- Enable LSP completion via nvim-cmp or built-in omnifunc
if vim.fn.exists("##LspAttach") == 1 then
  -- nvim-cmp handles completions if installed
else
  vim.bo.omnifunc = "v:lua.vim.lsp.omnifunc"
end

-- Matchit support for block matching
if vim.fn.exists("b:match_words") == 0 then
  vim.b.match_words = [[<style>:</style>,<head>:</head>,{#server}:{/server},{#client}:{/client},<:>]]
end
