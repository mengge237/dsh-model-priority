// Ordered-list adapters: registerList({ id, read, write }).
const lists = new Map()

export function registerList(list) {
  if (!list || typeof list.id !== 'string' || !list.id) throw new Error('list id required')
  if (typeof list.read !== 'function' || typeof list.write !== 'function') {
    throw new Error('list read/write required: ' + list.id)
  }
  lists.set(list.id, list)
  return function () { lists.delete(list.id) }
}

export function getList(id) {
  return lists.get(id)
}

export function listIds() {
  return [...lists.keys()]
}