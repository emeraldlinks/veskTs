local M = {}

local function find_root(startpath, markers)
  local uv = vim.uv or vim.loop
  local dir = uv.fs_realpath(startpath)
  while dir do
    for _, marker in ipairs(markers) do
      if vim.fn.filereadable(dir .. "/" .. marker) == 1 then
        return dir
      end
    end
    local parent = uv.fs_realpath(dir .. "/..")
    if parent == dir then break end
    dir = parent
  end
  return nil
end

local function find_lsp_server()
  local files = vim.api.nvim_get_runtime_file("lua/vesk/init.lua", false)
  local plugin_root
  if #files > 0 then
    plugin_root = vim.fn.fnamemodify(files[1], ":h:h:h")
  else
    -- Fallback: derive from debug source
    local src = debug.getinfo(1, "S").source
    local path = src:match("^@(.+)$") or src
    plugin_root = vim.fn.fnamemodify(path, ":h:h:h")
  end
  local candidates = {
    -- Built-in LSP server within the plugin directory
    plugin_root .. "/lsp-server/index.mjs",
    -- Relative to vsk-vscode (when plugin is in monorepo extension/)
    vim.fn.resolve(plugin_root .. "/../vsk-vscode/lsp-server/index.mjs"),
    -- From repo root
    vim.fn.resolve(plugin_root .. "/../../extension/vsk-vscode/lsp-server/index.mjs"),
  }
  for _, p in ipairs(candidates) do
    if vim.fn.filereadable(p) == 1 then
      return { "node", p }
    end
  end
  vim.notify(
    "[vesk] LSP server not found. Build it first:\n"
      .. "  cd " .. vim.fn.fnamemodify(plugin_root, ":h:h")
      .. " && node scripts/build-lsp.js",
    (vim.log and vim.log.levels and vim.log.levels.WARN) or "WARN"
  )
  return {}
end

function M.setup(opts)
  opts = opts or {}
  local lsp_cmd = opts.cmd or (opts.lsp_cmd and { "node", opts.lsp_cmd }) or find_lsp_server()

  vim.api.nvim_create_autocmd("FileType", {
    pattern = "vsk",
    callback = function(args)
      if #lsp_cmd == 0 then return end
      vim.lsp.start({
        name = "vesk",
        cmd = lsp_cmd,
        root_dir = find_root(vim.api.nvim_buf_get_name(args.buf), { "tsconfig.json", "jsconfig.json", "package.json" })
          or vim.fn.getcwd(),
        capabilities = opts.capabilities
          or (vim.lsp.protocol.make_client_capabilities and vim.lsp.protocol.make_client_capabilities()),
        settings = opts.settings or {},
      })
    end,
  })

  -- Default keymaps
  local map_opts = opts.keymaps
  if map_opts ~= false then
    vim.api.nvim_create_autocmd("FileType", {
      pattern = "vsk",
      callback = function(a)
        local buf = a.buf
        local map = vim.keymap.set
        local o = { buffer = buf, silent = true, noremap = true }
        if map_opts == nil or map_opts.definition ~= false then
          map("n", "gd", vim.lsp.buf.definition, o)
        end
        if map_opts == nil or map_opts.hover ~= false then
          map("n", "K", vim.lsp.buf.hover, o)
        end
        if map_opts == nil or map_opts.references ~= false then
          map("n", "gr", vim.lsp.buf.references, o)
        end
        if map_opts == nil or map_opts.rename ~= false then
          map("n", "gR", vim.lsp.buf.rename, o)
        end
        if map_opts == nil or map_opts.code_action ~= false then
          map({ "n", "x" }, "<leader>ca", vim.lsp.buf.code_action, o)
        end
        if map_opts == nil or map_opts.format ~= false then
          map("n", "<leader>f", function() vim.lsp.buf.format({ async = true }) end, o)
        end
        if map_opts == nil or map_opts.organize_imports ~= false then
          map("n", "<leader>oi", function()
            vim.lsp.buf.code_action({
              context = { only = { "source.organizeImports" } },
            })
          end, o)
        end
        if map_opts == nil or map_opts.document_symbols ~= false then
          map("n", "<leader>ds", vim.lsp.buf.document_symbol, o)
        end
        if map_opts == nil or map_opts.workspace_symbols ~= false then
          map("n", "<leader>ws", vim.lsp.buf.workspace_symbol, o)
        end
      end,
    })
  end
end

return M
