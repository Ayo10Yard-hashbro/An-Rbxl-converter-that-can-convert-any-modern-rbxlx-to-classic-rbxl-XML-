'use strict';

class Reader {
  constructor(buf) {
    this.buf = buf;
    this.pos = 0;
  }

  remaining() {
    return this.buf.length - this.pos;
  }

  bytes(n) {
    const b = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return b;
  }

  u8() {
    const v = this.buf.readUInt8(this.pos);
    this.pos += 1;
    return v;
  }

  i8() {
    const v = this.buf.readInt8(this.pos);
    this.pos += 1;
    return v;
  }

  u16le() {
    const v = this.buf.readUInt16LE(this.pos);
    this.pos += 2;
    return v;
  }

  u16be() {
    const v = this.buf.readUInt16BE(this.pos);
    this.pos += 2;
    return v;
  }

  i32le() {
    const v = this.buf.readInt32LE(this.pos);
    this.pos += 4;
    return v;
  }

  u32le() {
    const v = this.buf.readUInt32LE(this.pos);
    this.pos += 4;
    return v;
  }

  u32be() {
    const v = this.buf.readUInt32BE(this.pos);
    this.pos += 4;
    return v;
  }

  i32be() {
    const v = this.buf.readInt32BE(this.pos);
    this.pos += 4;
    return v;
  }

  f32le() {
    const v = this.buf.readFloatLE(this.pos);
    this.pos += 4;
    return v;
  }

  f64le() {
    const v = this.buf.readDoubleLE(this.pos);
    this.pos += 8;
    return v;
  }

  i64le() {
    const v = this.buf.readBigInt64LE(this.pos);
    this.pos += 8;
    return v;
  }

  string() {
    const len = this.u32le();
    const b = this.bytes(len);
    return b.toString('utf8');
  }
}

module.exports = { Reader };
