/**
 * Just enough of a Socket.IO v4 client for k6, which has WebSockets but no
 * Socket.IO. Speaks Engine.IO 4 over the websocket transport, which is what the
 * web client uses too (`transports: ['websocket']`).
 *
 *   0{...}        server open        -> we answer 40 (connect to "/")
 *   40{sid}       namespace connected
 *   2 / 3         server ping / our pong
 *   42[ev,...]    event;   42<id>[ev,...] event wanting an ack
 *   43<id>[...]   ack for one of ours
 */
import { WebSocket } from 'k6/websockets';
import { setTimeout, clearTimeout } from 'k6/timers';

export class SioClient {
  constructor(baseUrl) {
    this.handlers = new Map();
    this.acks = new Map();
    this.nextAck = 0;
    this.connected = false;
    this.closed = false;

    this.ready = new Promise((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
    });

    const url = `${baseUrl.replace(/^http/, 'ws')}/socket.io/?EIO=4&transport=websocket`;
    this.ws = new WebSocket(url);
    this.ws.onmessage = (e) => this._packet(String(e.data));
    this.ws.onerror = (e) => {
      if (!this.connected) this._reject(new Error(`websocket error: ${e.error ?? e}`));
    };
    this.ws.onclose = () => {
      const was = this.connected;
      this.connected = false;
      this.closed = true;
      if (!was) this._reject(new Error('closed before connecting'));
      for (const { reject, timer } of this.acks.values()) {
        clearTimeout(timer);
        reject(new Error('socket closed'));
      }
      this.acks.clear();
      this._dispatch('disconnect', []);
    };
  }

  on(event, fn) {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event).push(fn);
  }

  /** Fire and forget, like socket.emit without a callback. */
  emit(event, data) {
    if (!this.connected) return;
    this.ws.send(`42${JSON.stringify(data === undefined ? [event] : [event, data])}`);
  }

  /** socket.emit with a callback, as a promise of the callback's first argument. */
  request(event, data, timeoutMs = 10_000) {
    if (!this.connected) return Promise.reject(new Error('not connected'));
    const id = this.nextAck++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.acks.delete(id);
        reject(new Error(`${event} ack timed out`));
      }, timeoutMs);
      this.acks.set(id, { resolve, reject, timer });
      this.ws.send(`42${id}${JSON.stringify(data === undefined ? [event] : [event, data])}`);
    });
  }

  close() {
    if (this.closed) return;
    if (this.connected) this.ws.send('41');
    this.ws.close();
  }

  _packet(data) {
    switch (data[0]) {
      case '0': this.ws.send('40'); return;
      case '2': this.ws.send('3'); return;
      case '1': this.ws.close(); return;
      case '4': break;
      default: return;
    }
    const kind = data[1];
    if (kind === '0') {
      this.connected = true;
      this._resolve(this);
      return;
    }
    if (kind === '4') {
      this._reject(new Error(`connect refused: ${data.slice(2)}`));
      return;
    }
    if (kind !== '2' && kind !== '3') return;

    const open = data.indexOf('[');
    if (open < 0) return;
    const id = data.slice(2, open);
    const payload = JSON.parse(data.slice(open));

    if (kind === '3') {
      const pending = this.acks.get(Number(id));
      if (!pending) return;
      this.acks.delete(Number(id));
      clearTimeout(pending.timer);
      pending.resolve(payload[0]);
      return;
    }
    const [event, ...args] = payload;
    this._dispatch(event, args);
  }

  _dispatch(event, args) {
    const list = this.handlers.get(event);
    if (list) for (const fn of list) fn(...args);
  }
}
