# Hydration Experiment

True hydration: walk existing SSR DOM, claim elements, attach effects/handlers.
Zero DOM mutations = zero content shift.

## Approach

Instead of `createElement` + `replaceChildren`, each component claims
existing SSR DOM elements by walking parent's children and matching by tag.

```
SSR DOM:
#root
├── nav[data-vsk="0"]      ← Layout claims (tag=nav)
│   ├── a (Home)           ← NavLink claims (tag=a)
│   ├── a (About)          ← NavLink claims (tag=a)
│   └── a (Blog)           ← NavLink claims (tag=a)
├── main[data-vsk="1"]     ← Layout claims (tag=main)
│   ├── h1                 ← Page claims (tag=h1)
│   ├── p (description)    ← Page claims (tag=p)
│   ├── p[data-vsk="0"]    ← Page claims → reactive count
│   ├── button[data-vsk="1"]← Page claims → click handler
│   └── div                ← Page claims (tag=div)
└── footer                 ← Layout claims (tag=footer)
```

Each component gets a **scoped walker** — iterates only its parent's children.
No flat global list. No ordering conflicts.
