'use strict';

function buildDom(parsed) {
  const instances = new Map(); // referent(number) -> instance node

  for (const [classId, cls] of parsed.classes.entries()) {
    cls.referents.forEach((ref) => {
      instances.set(ref, {
        referent: ref,
        className: cls.className,
        isService: cls.isService,
        properties: new Map(), // name -> {typeId, value}
        children: [],
        parent: null,
      });
    });
  }

  for (const prop of parsed.properties) {
    const cls = parsed.classes.get(prop.classId);
    if (!cls) continue;
    cls.referents.forEach((ref, idx) => {
      const inst = instances.get(ref);
      if (!inst) return;
      inst.properties.set(prop.name, { typeId: prop.typeId, value: prop.values[idx] });
    });
  }

  const roots = [];
  const n = parsed.parentChildren.length;
  for (let i = 0; i < n; i++) {
    const childRef = parsed.parentChildren[i];
    const parentRef = parsed.parentParents[i];
    const child = instances.get(childRef);
    if (!child) continue;
    if (parentRef === -1 || !instances.has(parentRef)) {
      roots.push(child);
    } else {
      const parent = instances.get(parentRef);
      child.parent = parent;
      parent.children.push(child);
    }
  }

  return { instances, roots };
}

module.exports = { buildDom };
