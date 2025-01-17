import { ParseTreeWalker } from './parseTreeWalker';
import { TypeEvaluator } from './typeEvaluatorTypes';
import { FunctionType, OverloadedFunctionType, Type, TypeCategory, TypeFlags } from './types';
import {
    ClassNode,
    FunctionNode,
    ImportAsNode,
    ImportFromAsNode,
    ImportFromNode,
    NameNode,
    TypeAliasNode,
} from '../parser/parseNodes';
import { SemanticTokenModifiers, SemanticTokenTypes } from 'vscode-languageserver';
import { isConstantName } from './symbolNameUtils';

export type SemanticTokenItem = {
    type: string;
    modifiers: string[];
    start: number;
    length: number;
};

export class SemanticTokensWalker extends ParseTreeWalker {
    items: SemanticTokenItem[] = [];

    constructor(private readonly _evaluator?: TypeEvaluator) {
        super();
    }
    override visitClass(node: ClassNode): boolean {
        this._addItem(node.name.start, node.name.length, SemanticTokenTypes.class, [SemanticTokenModifiers.definition]);
        return super.visitClass(node);
    }

    override visitFunction(node: FunctionNode): boolean {
        const modifiers = [SemanticTokenModifiers.definition];
        if (node.isAsync) {
            modifiers.push(SemanticTokenModifiers.async);
        }
        //TODO: whats the correct type here
        if ((node as any).declaration?.isMethod) {
            this._addItem(node.name.start, node.name.length, SemanticTokenTypes.method, modifiers);
        } else {
            this._addItem(node.name.start, node.name.length, SemanticTokenTypes.function, modifiers);
        }
        // parameters & return type are covered by visitName
        return super.visitFunction(node);
    }

    override visitImportAs(node: ImportAsNode): boolean {
        for (const part of node.module.nameParts) {
            this._addItem(part.start, part.length, SemanticTokenTypes.namespace, []);
        }
        if (node.alias) {
            this._addItem(node.alias.start, node.alias.length, SemanticTokenTypes.namespace, []);
        }
        return super.visitImportAs(node);
    }

    override visitImportFromAs(node: ImportFromAsNode): boolean {
        this._visitNameWithType(node.name, this._evaluator?.getType(node.alias ?? node.name));
        return super.visitImportFromAs(node);
    }

    override visitImportFrom(node: ImportFromNode): boolean {
        for (const part of node.module.nameParts) {
            this._addItem(part.start, part.length, SemanticTokenTypes.namespace, []);
        }
        return super.visitImportFrom(node);
    }

    override visitName(node: NameNode): boolean {
        this._visitNameWithType(node, this._evaluator?.getType(node));
        return super.visitName(node);
    }

    override visitTypeAlias(node: TypeAliasNode): boolean {
        // this shouldn't be needed because keywords are part of syntax highlighting, not semantic highlighting,
        // but vscode incorrectly treats the type keyword as a type instead of a keyword so we need to fix it
        // TODO: keyword makes it purple like `if`, `for`, `import`, etc. but the `type` keyword is more like
        // `def`, `class` and `lambda` which are blue but i can't figure out what semantic token type does that.
        this._addItem(node.start, 4 /* length of the word "type" */, SemanticTokenTypes.keyword, []);
        return super.visitTypeAlias(node);
    }

    private _visitNameWithType(node: NameNode, type: Type | undefined) {
        switch (type?.category) {
            case TypeCategory.Function:
                if (type.flags & TypeFlags.Instance)
                    if ((type as FunctionType).details.declaration?.isMethod) {
                        this._addItem(node.start, node.length, SemanticTokenTypes.method, []);
                    } else {
                        this._addItem(node.start, node.length, SemanticTokenTypes.function, []);
                    }
                else {
                    // type alias to Callable
                    this._addItem(node.start, node.length, SemanticTokenTypes.type, []);
                }
                return;
            case TypeCategory.OverloadedFunction:
                if (type.flags & TypeFlags.Instance) {
                    if (OverloadedFunctionType.getOverloads(type)[0].details.declaration?.isMethod) {
                        this._addItem(node.start, node.length, SemanticTokenTypes.method, []);
                    } else {
                        this._addItem(node.start, node.length, SemanticTokenTypes.function, []);
                    }
                } else {
                    // dunno if this is possible but better safe than sorry!!!
                    this._addItem(node.start, node.length, SemanticTokenTypes.type, []);
                }
                return;

            case TypeCategory.Module:
                this._addItem(node.start, node.length, SemanticTokenTypes.namespace, []);
                return;
            case TypeCategory.Unbound:
            case TypeCategory.Unknown:
            case undefined:
                return;
            case TypeCategory.TypeVar:
                if (!(type.flags & TypeFlags.Instance)) {
                    this._addItem(node.start, node.length, SemanticTokenTypes.typeParameter, []);
                    return;
                }
                break;
            case TypeCategory.Union:
                if (!(type.flags & TypeFlags.Instance)) {
                    this._addItem(node.start, node.length, SemanticTokenTypes.type, []);
                    return;
                }
                break;
            case TypeCategory.Class:
                //type annotations handled by visitTypeAnnotation
                if (!(type.flags & TypeFlags.Instance)) {
                    this._addItem(node.start, node.length, SemanticTokenTypes.class, []);
                    return;
                }
        }
        const symbol = this._evaluator?.lookUpSymbolRecursive(node, node.value, false)?.symbol;
        if (type?.category === TypeCategory.Never && symbol && !this._evaluator.getDeclaredTypeOfSymbol(symbol).type) {
            // for some reason Never is considered both instantiable and an instance, so we need to look up the type this way
            // to differentiate between "instances" of `Never` and type aliases/annotations of Never:
            this._addItem(node.start, node.length, SemanticTokenTypes.type, []);
        } else if (isConstantName(node.value) || (symbol && this._evaluator.isFinalVariable(symbol))) {
            this._addItem(node.start, node.length, SemanticTokenTypes.variable, [SemanticTokenModifiers.readonly]);
        } else {
            this._addItem(node.start, node.length, SemanticTokenTypes.variable, []);
        }
    }

    private _addItem(start: number, length: number, type: string, modifiers: string[]) {
        this.items.push({ type, modifiers, start, length });
    }
}
