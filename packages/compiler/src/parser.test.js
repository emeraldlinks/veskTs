/**
 * Parser Proof of Concept — Test
 *
 * Verifies the base Acorn + TypeScript parser can handle:
 * 1. TypeScript type annotations
 * 2. JSX elements
 * 3. Generic type parameters
 * 4. Async/await
 * 5. Destructuring
 */
import { describe, it, expect } from 'vitest';
import { parse } from './parser.js';

describe('Base Parser (Acorn + TypeScript)', () => {
  it('parses plain TypeScript', () => {
    const ast = parse(`const x: number = 42;`);
    expect(ast.type).toBe('Program');
    expect(ast.body[0].type).toBe('VariableDeclaration');
  });

  it('parses JSX elements', () => {
    const ast = parse(`const el = <div className="hello">Hello</div>;`);
    expect(ast.body[0].declarations[0].init.type).toBe('JSXElement');
  });

  it('parses TypeScript generics', () => {
    const ast = parse(`function identity<T>(arg: T): T { return arg; }`);
    const fn = ast.body[0];
    expect(fn.type).toBe('FunctionDeclaration');
    expect(fn.typeParameters).toBeTruthy();
    expect(fn.typeParameters.params[0].name).toBe('T');
  });

  it('parses async/await', () => {
    const ast = parse(`
      async function fetchData(): Promise<string> {
        const result = await fetch('/api');
        return result.text();
      }
    `);
    expect(ast.body[0].async).toBe(true);
  });

  it('parses destructuring with types', () => {
    const ast = parse(`
      const { name, age }: { name: string; age: number } = person;
    `);
    expect(ast.body[0].declarations[0].id.type).toBe('ObjectPattern');
  });

  it('parses arrow functions with JSX', () => {
    const ast = parse(`
      const Greeting = ({ name }: { name: string }) => <div>Hello {name}</div>;
    `);
    const init = ast.body[0].declarations[0].init;
    expect(init.type).toBe('ArrowFunctionExpression');
    expect(init.body.type).toBe('JSXElement');
  });

  it('parses component-like function declarations', () => {
    const ast = parse(`
      function TodoList(props: { todos: string[] }) {
        return (
          <div>
            {props.todos.map((todo) => <li key={todo}>{todo}</li>)}
          </div>
        );
      }
    `);
    expect(ast.body[0].type).toBe('FunctionDeclaration');
    expect(ast.body[0].id.name).toBe('TodoList');
    expect(ast.body[0].body.body[0].argument.type).toBe('JSXElement');
  });

  it('parses export default', () => {
    const ast = parse(`export default function App() { return <div />; }`);
    expect(ast.body[0].type).toBe('ExportDefaultDeclaration');
  });

  it('parses interface declarations', () => {
    const ast = parse(`
      interface Props {
        name: string;
        age?: number;
      }
    `);
    expect(ast.body[0].type).toBe('TSInterfaceDeclaration');
  });

  it('parses complex nested JSX with expressions', () => {
    const ast = parse(`
      const App = () => (
        <div className="app">
          <header>
            <h1>{title}</h1>
            {showNav && <Nav items={items} />}
          </header>
          <main>
            {items.map((item, i) => (
              <Component key={i} {...item} />
            ))}
          </main>
        </div>
      );
    `);
    expect(ast.body[0].declarations[0].init.body.type).toBe('JSXElement');
  });
});
