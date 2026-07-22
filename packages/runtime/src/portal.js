export function Portal(props, __registry, __ctx) {
  if (typeof document === 'undefined') return '';
  const target = typeof props.target === 'string'
    ? document.querySelector(props.target)
    : props.target;
  if (!target) return document.createComment('portal: no target');
  if (props.children != null) {
    if (typeof props.children === 'function') {
      const frag = document.createDocumentFragment();
      props.children(frag);
      target.appendChild(frag);
    } else {
      target.appendChild(props.children);
    }
  }
  return document.createComment('portal');
}
