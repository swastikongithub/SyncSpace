export class Emitter {
  #listeners = new Map();

  on(event, listener) {
    if (!this.#listeners.has(event)) this.#listeners.set(event, new Set());
    this.#listeners.get(event).add(listener);
    return () => this.#listeners.get(event)?.delete(listener);
  }

  emit(event, payload) {
    for (const listener of this.#listeners.get(event) ?? []) listener(payload);
  }

  clearListeners() {
    this.#listeners.clear();
  }
}
