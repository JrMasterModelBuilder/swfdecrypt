import {
	subview,
	readNullTerminated
} from './data.mjs';

export const ActionAdd = 0x0A;
export const ActionSubtract = 0x0B;
export const ActionMultiply = 0x0C;
export const ActionEquals = 0x0E;
export const ActionNot = 0x12;
export const ActionGetVariable = 0x1C;
export const ActionSetVariable = 0x1D;
export const ActionDefineLocal = 0x3C;
export const ActionCallFunction = 0x3D;
export const ActionReturn = 0x3E;
export const ActionModulo = 0x3F;
export const ActionAdd2 = 0x47;
export const ActionConstantPool = 0x88;
export const ActionWaitForFrame = 0x8A;
export const ActionWaitForFrame2 = 0x8D;
export const ActionDefineFunction2 = 0x8E;
export const ActionWith = 0x94;
export const ActionPush = 0x96;
export const ActionDefineFunction = 0x9B;
export const ActionJump = 0x99;
export const ActionIf = 0x9D;

const actions = (new Array(0xFF)).fill(null);
actions[ActionAdd] = vm => {
	const a = vm.scope.stack.pop();
	const b = vm.scope.stack.pop();
	vm.scope.stack.push(a + b);
};
actions[ActionSubtract] = vm => {
	const a = vm.scope.stack.pop();
	const b = vm.scope.stack.pop();
	vm.scope.stack.push(b - a);
};
actions[ActionMultiply] = vm => {
	const a = vm.scope.stack.pop();
	const b = vm.scope.stack.pop();
	vm.scope.stack.push(a * b);
};
actions[ActionEquals] = vm => {
	const a = vm.scope.stack.pop();
	const b = vm.scope.stack.pop();
	vm.scope.stack.push(a == b);
};
actions[ActionNot] = vm => {
	const value = vm.scope.stack.pop();
	vm.scope.stack.push(!value);
};
actions[ActionGetVariable] = vm => {
	const name = vm.scope.stack.pop();
	const value = vm.scope.scopeGet(name);
	vm.scope.stack.push(value);
};
actions[ActionSetVariable] = vm => {
	const value = vm.scope.stack.pop();
	const name = vm.scope.stack.pop();
	vm.scope.scopeSet(name, value);
};
actions[ActionDefineLocal] = vm => {
	const value = vm.scope.stack.pop();
	const name = vm.scope.stack.pop();
	vm.scope.localSet(name, value);
};
actions[ActionCallFunction] = vm => {
	const name = vm.scope.stack.pop();
	const numArgs = vm.scope.stack.pop();
	const args = [];
	for (let i = 0; i < numArgs; i++) {
		args.push(vm.scope.stack.pop());
	}
	const f = vm.scope.scopeGet(name);
	vm.scopePush();
	vm.calls.push(vm.pc);
	if (name) {
		vm.scope.localSet(name, f);
	}
	for (let i = 0; i < f.params.length; i++) {
		vm.scope.localSet(f.params[i], args[i]);
	}
	vm.pc = f.pc;
};
actions[ActionReturn] = vm => {
	const value = vm.scope.stack.pop();
	vm.scopePop();
	vm.scope.stack.push(value);
	vm.pc = vm.calls.pop();
};
actions[ActionModulo] = vm => {
	const x = vm.scope.stack.pop();
	const y = vm.scope.stack.pop();
	// Spec incorrectly says x % y?
	vm.scope.stack.push(y % x);
};
actions[ActionAdd2] = vm => {
	const a = vm.scope.stack.pop();
	const b = vm.scope.stack.pop();
	vm.scope.stack.push(a + b);
};
actions[ActionConstantPool] = (vm, data) => {
	const constants = [];
	let i = 0;
	const count = data.readUInt16LE(i);
	i += 2;
	for (let n = 0; n < count; n++) {
		const d = readNullTerminated(data, i);
		i += d.length;
		constants.push(d.subarray(0, -1).toString('utf8'));
	}
	vm.scope.constants = constants;
};
actions[ActionPush] = (vm, data) => {
	const values = [];
	for (let i = 0; i < data.length;) {
		const type = data.readUInt8(i++);
		let value;
		switch (type) {
			case 0: {
				const d = readNullTerminated(data, i);
				value = d.subarray(0, -1).toString('utf8');
				i += d.length;
				break;
			}
			case 5: {
				value = !!data.readUInt8(i++);
				break;
			}
			case 6: {
				value = data.readDoubleLE(i);
				i += 8;
				break;
			}
			case 7: {
				// Spec incorrectly says unsigned?
				value = data.readInt32LE(i);
				i += 4;
				break;
			}
			default: {
				throw new Error(`Unknown type: ${type}`);
			}
		}
		values.push(value);
	}
	vm.scope.stack.push(...values);
};
actions[ActionDefineFunction] = (vm, data) => {
	const nameData = readNullTerminated(data, 0);
	const name = nameData.subarray(0, -1).toString('utf8');
	let i = nameData.length;
	const params = [];
	const numParams = data.readUInt16LE(i);
	i += 2;
	for (let n = 0; n < numParams; n++) {
		const d = readNullTerminated(data, i);
		i += d.length;
		params.push(d.subarray(0, -1).toString('utf8'));
	}
	const codeSize = data.readUInt16LE(i);
	const f = new VarFunctionBytecode(name, params, vm.pc);
	if (name) {
		vm.scope.localSet(name, f);
	}
	else {
		vm.scope.stack.push(f);
	}
	vm.pc += codeSize;
};
actions[ActionJump] = (vm, data) => {
	vm.pc += data.readInt16LE(0);
};
actions[ActionIf] = (vm, data) => {
	const value = vm.scope.stack.pop();
	if (value) {
		vm.pc += data.readInt16LE(0);
	}
};

export class Scope extends Object {
	constructor(parent = null) {
		super();

		this.global = parent ? parent.global : this;
		this.parent = parent;
		this.locals = new Map();
		this.stack = [];
		this.constants = [];
	}

	localHas(name) {
		return this.locals.has(name);
	}

	localGet(name) {
		return this.locals.get(name);
	}

	localSet(name, value) {
		this.locals.set(name, value);
	}

	scopeFind(name) {
		for (let scope = this; scope; scope = scope.parent) {
			if (scope.localHas(name)) {
				return scope;
			}
		}
		return null;
	}

	scopeHas(name) {
		return !!this.scopeFind(name);
	}

	scopeGet(name) {
		const scope = this.scopeFind(name);
		return scope ? scope.localGet(name) : undefined;
	}

	scopeSet(name, value) {
		const scope = this.scopeFind(name);
		(scope || this.global).localSet(name, value);
	}
}

export class Var extends Object {
	constructor() {
		super();
	}
}

export class VarObject extends Var {
	constructor() {
		super();
	}
}

export class VarFunction extends VarObject {
	constructor(name, params) {
		super();

		this.name = name;
		this.params = params;
	}
}

export class VarFunctionBytecode extends VarFunction {
	constructor(name, params, ip) {
		super(name, params);

		this.pc = ip;
	}
}

export class ASVM1 extends Object {
	constructor(code, ip = 0) {
		super();

		this.code = code;
		this.pc = ip;
		this.calls = [];
		this.scope = new Scope();
		this.actions = actions.slice(0);
	}

	scopePush() {
		this.scope = new Scope(this.scope);
	}

	scopePop() {
		this.scope = this.scope.parent;
	}

	nextOpcode() {
		return this.code.readUInt8(this.pc);
	}

	nextAction() {
		const {pc, code} = this;
		let size = 0;
		const opcode = code.readUInt8(pc + (size++));
		let data = null;
		if (opcode >= 0x80) {
			const l = code.readUInt16LE(pc + size);
			size += 2;
			data = subview(code, pc + size, l);
			size += l;
		}
		return {
			opcode,
			data,
			size
		};
	}

	readAction() {
		const {opcode, size, data} = this.nextAction();
		this.pc += size;
		return {
			opcode,
			data
		};
	}

	step() {
		const {pc} = this;
		const {opcode, data} = this.readAction();
		if (!opcode) {
			return false;
		}

		const action = this.actions[opcode];
		if (!action) {
			const hex = opcode.toString(16).toUpperCase().padStart(2, '0');
			throw new Error(`Unknown opcode: 0x${hex} at: ${pc}`);
		}
		action(this, data);
		return true;
	}
}
