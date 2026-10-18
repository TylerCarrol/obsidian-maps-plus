// Minimal stand-ins for the Obsidian value classes, so parser tests can run outside Obsidian.

type MockValueInput = Value | string | number | null | undefined | MockValueInput[];

export abstract class Value {
	abstract toString(): string;
	abstract isTruthy(): boolean;

	static equals(left: Value | null, right: Value | null): boolean {
		if (left === right) return true;
		if (!left || !right) return false;
		return left.toString() === right.toString();
	}
}

export class StringValue extends Value {
	constructor(private readonly value: string) {
		super();
	}

	toString(): string {
		return this.value;
	}

	isTruthy(): boolean {
		return this.value.length > 0;
	}
}

export class NumberValue extends Value {
	constructor(private readonly value: number) {
		super();
	}

	toString(): string {
		return this.value.toString();
	}

	isTruthy(): boolean {
		return this.value !== 0;
	}
}

export class NullValue extends Value {
	static readonly value = new NullValue();

	toString(): string {
		return 'null';
	}

	isTruthy(): boolean {
		return false;
	}
}

export class ListValue extends Value {
	private readonly values: Value[];

	constructor(value: MockValueInput[]) {
		super();
		this.values = value.map(entry => toValue(entry));
	}

	toString(): string {
		return `[${this.values.map(value => value.toString()).join(', ')}]`;
	}

	isTruthy(): boolean {
		return this.values.length > 0;
	}

	length(): number {
		return this.values.length;
	}

	get(index: number): Value {
		return this.values[index] ?? NullValue.value;
	}
}

function toValue(input: MockValueInput): Value {
	if (input instanceof Value) return input;
	if (typeof input === 'string') return new StringValue(input);
	if (typeof input === 'number') return new NumberValue(input);
	if (Array.isArray(input)) return new ListValue(input);
	if (input == null) return NullValue.value;

	throw new TypeError('Unsupported mock value type');
}
