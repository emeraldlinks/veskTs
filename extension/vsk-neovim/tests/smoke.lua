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

-- Shipped logo is used for image-based explorers (neo-tree, etc).
assert_true(
  vim.fn.filereadable(root .. "/icons/vsk-file-icon.png") == 1,
  "shipped .vsk file icon is missing"
)

-- Without nvim-web-devicons installed, registering the icon must be a silent no-op.
package.loaded["nvim-web-devicons"] = nil
local no_op_ok, vesk = pcall(require, "vesk")
assert_true(no_op_ok and type(vesk._register_devicon) == "function", "vesk._register_devicon is missing")
assert_true(pcall(vesk._register_devicon), "missing devicons broke setup")

-- With it installed, .vsk must resolve to a registered icon.
local registered = nil
package.loaded["nvim-web-devicons"] = {
  set_icon = function(spec) registered = spec end,
}
require("vesk")._register_devicon()
assert_true(type(registered) == "table", "devicons set_icon was never called")
assert_true(type(registered.vsk) == "table", "vsk icon was not registered")
assert_true(type(registered.vsk.icon) == "string" and registered.vsk.icon ~= "", "vsk icon glyph is empty")
assert_true(type(registered.vsk.color) == "string" and registered.vsk.color ~= "", "vsk icon color is empty")
assert_true(type(registered.vsk.name) == "string" and registered.vsk.name ~= "", "vsk icon name is empty")
package.loaded["nvim-web-devicons"] = nil

print("Neovim plugin setup smoke: PASS")
vim.cmd("qa!")
