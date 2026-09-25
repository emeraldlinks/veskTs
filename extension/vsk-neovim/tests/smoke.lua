local root = vim.fn.fnamemodify(debug.getinfo(1, "S").source:sub(2), ":h:h")
vim.opt.runtimepath:prepend(root)

local function assert_true(value, message)
  if not value then error(message, 2) end
end

assert_true(vim.fn.filereadable(root .. "/lsp-server/index.mjs") == 1, "bundled LSP server is missing")
require("vesk").setup({})

vim.cmd("enew")
vim.bo.filetype = "vsk"
vim.wait(1000, function()
  return vim.fn.maparg("gd", "n", false, true).buffer == 1
end, 20)

assert_true(vim.bo.filetype == "vsk", ".vsk filetype was not registered")
assert_true(vim.fn.maparg("gd", "n", false, true).buffer == 1, "definition keymap was not installed")
assert_true(vim.fn.maparg("K", "n", false, true).buffer == 1, "hover keymap was not installed")
assert_true(vim.fn.maparg("<leader>f", "n", false, true).buffer == 1, "format keymap was not installed")

print("Neovim plugin setup smoke: PASS")
vim.cmd("qa!")
