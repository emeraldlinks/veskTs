export function tsPlugin(options: any): (Parser: any) => {
    new (options2: any, input: any, startPos: any): {
        [x: string]: any;
        preValue: any;
        preToken: any;
        isLookahead: boolean;
        maxEmittedCommentStart: number;
        isAmbientContext: boolean;
        inAbstractClass: boolean;
        inType: boolean;
        inDisallowConditionalTypesContext: boolean;
        maybeInArrowParameters: boolean;
        decoratorStack: never[][];
        importsStack: never[][];
        tsParseConstModifier: (node: any) => void;
        ecmaVersion: any;
        get acornTypeScript(): any;
        getTokenFromCodeInType(code: any): any;
        readToken(code: any): any;
        getTokenFromCode(code: any): any;
        isAbstractClass(): boolean;
        finishNode(node: any, type: any): any;
        tryParse(fn: any, oldState?: {
            pos: any;
            value: any;
            type: any;
            start: any;
            end: any;
            context: any;
            startLoc: any;
            lastTokEndLoc: any;
            endLoc: any;
            lastTokEnd: any;
            lastTokStart: any;
            lastTokStartLoc: any;
            curLine: any;
            lineStart: any;
            curPosition: any;
            containsEsc: any;
        }): {
            node: any;
            error: null;
            thrown: boolean;
            aborted: boolean;
            failState: null;
        } | {
            node: null;
            error: SyntaxError;
            thrown: boolean;
            aborted: boolean;
            failState: {
                endLoc: any;
                lastTokEnd: any;
                lastTokStart: any;
                lastTokStartLoc: any;
                pos: any;
                value: any;
                type: any;
                start: any;
                end: any;
                context: any;
                startLoc: any;
                lastTokEndLoc: any;
                curLine: any;
                lineStart: any;
                curPosition: any;
                containsEsc: any;
            };
        } | {
            node: null;
            error: null;
            thrown: boolean;
            aborted: boolean;
            failState: {
                endLoc: any;
                lastTokEnd: any;
                lastTokStart: any;
                lastTokStartLoc: any;
                pos: any;
                value: any;
                type: any;
                start: any;
                end: any;
                context: any;
                startLoc: any;
                lastTokEndLoc: any;
                curLine: any;
                lineStart: any;
                curPosition: any;
                containsEsc: any;
            };
        };
        setOptionalParametersError(refExpressionErrors: any, resultError: any): void;
        reScan_lt_gt(): void;
        reScan_lt(): any;
        resetEndLocation(node: any, endPos?: any, endLoc?: any): void;
        startNodeAtNode(type: any): any;
        nextTokenStart(): any;
        tsHasSomeModifiers(member: any, modifiers: any): any;
        tsIsStartOfStaticBlocks(): any;
        tsCheckForInvalidTypeCasts(items: any): void;
        atPossibleAsyncArrow(base: any): boolean;
        tsIsIdentifier(): any;
        tsTryParseTypeOrTypePredicateAnnotation(): any;
        tsTryParseGenericAsyncArrowFunction(startPos: any, startLoc: any, forInit: any): any;
        tsParseTypeArgumentsInExpression(): any;
        tsInNoContext(cb: any): any;
        context: any;
        tsTryParseTypeAnnotation(): any;
        isUnparsedContextual(nameStart: any, name: any): boolean;
        isAbstractConstructorSignature(): boolean;
        nextTokenStartSince(pos: any): any;
        lookaheadCharCode(): any;
        compareLookaheadState(state: any, state2: any): boolean;
        createLookaheadState(): void;
        value: any;
        getCurLookaheadState(): {
            endLoc: any;
            lastTokEnd: any;
            lastTokStart: any;
            lastTokStartLoc: any;
            pos: any;
            value: any;
            type: any;
            start: any;
            end: any;
            context: any;
            startLoc: any;
            lastTokEndLoc: any;
            curLine: any;
            lineStart: any;
            curPosition: any;
            containsEsc: any;
        };
        cloneCurLookaheadState(): {
            pos: any;
            value: any;
            type: any;
            start: any;
            end: any;
            context: any;
            startLoc: any;
            lastTokEndLoc: any;
            endLoc: any;
            lastTokEnd: any;
            lastTokStart: any;
            lastTokStartLoc: any;
            curLine: any;
            lineStart: any;
            curPosition: any;
            containsEsc: any;
        };
        setLookaheadState(state: any): void;
        pos: any;
        endLoc: any;
        lastTokEnd: any;
        lastTokStart: any;
        lastTokStartLoc: any;
        type: any;
        start: any;
        end: any;
        startLoc: any;
        lastTokEndLoc: any;
        curLine: any;
        lineStart: any;
        curPosition: any;
        containsEsc: any;
        tsLookAhead(f: any): any;
        lookahead(number: any): {
            endLoc: any;
            lastTokEnd: any;
            lastTokStart: any;
            lastTokStartLoc: any;
            pos: any;
            value: any;
            type: any;
            start: any;
            end: any;
            context: any;
            startLoc: any;
            lastTokEndLoc: any;
            curLine: any;
            lineStart: any;
            curPosition: any;
            containsEsc: any;
        };
        readWord(): void;
        skipBlockComment(): void;
        skipLineComment(startSkip: any): void;
        finishToken(type: any, val: any): void;
        resetStartLocation(node: any, start: any, startLoc: any): void;
        isLineTerminator(): any;
        hasFollowingLineBreak(): boolean;
        addExtra(node: any, key: any, value: any, enumerable?: boolean): void;
        /**
         * Test if current token is a literal property name
         * https://tc39.es/ecma262/#prod-LiteralPropertyName
         * LiteralPropertyName:
         *   IdentifierName
         *   StringLiteral
         *   NumericLiteral
         *   BigIntLiteral
         */
        isLiteralPropertyName(): any;
        hasPrecedingLineBreak(): any;
        createIdentifier(node: any, name: any): any;
        /**
         * Reset the start location of node to the start location of locationNode
         */
        resetStartLocationFromNode(node: any, locationNode: any): void;
        isThisParam(param: any): boolean;
        isLookaheadContextual(name: any): boolean;
        /**
         * ts type isContextual
         * @param {TokenType} type
         * @param {TokenType} token
         * @returns {boolean}
         * */
        ts_type_isContextual(type: TokenType, token: TokenType): boolean;
        /**
         * ts isContextual
         * @param {TokenType} token
         * @returns {boolean}
         * */
        ts_isContextual(token: TokenType): boolean;
        ts_isContextualWithState(state: any, token: any): boolean;
        isContextualWithState(keyword: any, state: any): boolean;
        tsIsStartOfMappedType(): boolean;
        tsInDisallowConditionalTypesContext(cb: any): any;
        tsTryParseType(): any;
        /**
         * Whether current token matches given type
         *
         * @param {TokenType} type
         * @returns {boolean}
         * @memberof Tokenizer
         */
        match(type: TokenType): boolean;
        matchJsx(type: any): boolean;
        ts_eatWithState(type: any, nextCount: any, state: any): boolean;
        ts_eatContextualWithState(name: any, nextCount: any, state: any): boolean;
        canHaveLeadingDecorator(): boolean;
        eatContextual(name: any): any;
        tsIsExternalModuleReference(): any;
        tsParseExternalModuleReference(): any;
        tsParseEntityName(allowReservedWords?: boolean): any;
        tsParseEnumMember(): any;
        tsParseEnumDeclaration(node: any, properties?: {}): any;
        tsParseModuleBlock(): any;
        tsParseAmbientExternalModuleDeclaration(node: any): any;
        tsTryParseDeclare(nany: any): any;
        tsIsListTerminator(kind: any): boolean | undefined;
        /**
         * If !expectSuccess, returns undefined instead of failing to parse.
         * If expectSuccess, parseElement should always return a defined value.
         */
        tsParseDelimitedListWorker(kind: any, parseElement: any, expectSuccess: any, refTrailingCommaPos: any): any[] | undefined;
        tsParseDelimitedList(kind: any, parseElement: any, refTrailingCommaPos: any): any;
        tsParseBracketedList(kind: any, parseElement: any, bracket: any, skipFirstToken: any, refTrailingCommaPos: any): any;
        tsParseTypeParameterName(): any;
        tsEatThenParseType(token: any): any;
        tsExpectThenParseType(token: any): any;
        tsNextThenParseType(): any;
        tsDoThenParseType(cb: any): any;
        tsSkipParameterStart(): boolean;
        tsIsUnambiguouslyStartOfFunctionType(): boolean;
        tsIsStartOfFunctionType(): any;
        tsInAllowConditionalTypesContext(cb: any): any;
        tsParseBindingListForSignature(): any;
        tsParseTypePredicateAsserts(): boolean;
        tsParseThisTypeNode(): any;
        tsParseTypeAnnotation(eatColon?: boolean, t?: any): any;
        tsParseThisTypePredicate(lhs: any): any;
        tsParseThisTypeOrThisTypePredicate(): any;
        tsParseTypePredicatePrefix(): any;
        tsParseTypeOrTypePredicateAnnotation(returnToken: any): any;
        tsFillSignature(returnToken: any, signature: any): void;
        tsTryNextParseConstantContext(): any;
        tsParseFunctionOrConstructorType(type: any, abstract: any): any;
        tsParseUnionOrIntersectionType(kind: any, parseConstituentType: any, operator: any): any;
        tsCheckTypeAnnotationForReadOnly(node: any): void;
        tsParseTypeOperator(): any;
        tsParseConstraintForInferType(): any;
        tsParseInferType(): any;
        tsParseLiteralTypeNode(): any;
        tsParseImportType(): any;
        tsParseTypeQuery(): any;
        tsParseMappedTypeParameter(): any;
        tsParseMappedType(): any;
        tsParseTypeLiteral(): any;
        tsParseTupleElementType(): any;
        tsParseTupleType(): any;
        tsParseTemplateLiteralType(): any;
        tsParseTypeReference(): any;
        tsMatchLeftRelational(): boolean;
        tsMatchRightRelational(): boolean;
        tsParseParenthesizedType(): any;
        tsParseNonArrayType(): any;
        tsParseArrayTypeOrHigher(): any;
        tsParseTypeOperatorOrHigher(): any;
        tsParseIntersectionTypeOrHigher(): any;
        tsParseUnionTypeOrHigher(): any;
        tsParseNonConditionalType(): any;
        /** Be sure to be in a type context before calling this, using `tsInType`. */
        tsParseType(): any;
        tsIsUnambiguouslyIndexSignature(): boolean;
        /**
         * Runs `cb` in a type context.
         * This should be called one token *before* the first type token,
         * so that the call to `next()` is run in type context.
         */
        tsInType(cb: any): any;
        tsTryParseIndexSignature(node: any): any;
        tsParseNoneModifiers(node: any): void;
        tsParseTypeParameter(parseModifiers?: (node: any) => void): any;
        tsParseTypeParameters(parseModifiers: any): any;
        tsTryParseTypeParameters(parseModifiers: any): any;
        tsTryParse(f: any): any;
        tsTokenCanFollowModifier(): any;
        tsNextTokenCanFollowModifier(): any;
        /** Parses a modifier matching one the given modifier names. */
        tsParseModifier(allowedModifiers: any, stopOnStartOfClassStaticBlock: any): any;
        tsParseModifiersByMap({ modified, map }: {
            modified: any;
            map: any;
        }): void;
        /** Parses a list of modifiers, in any order.
         *  If you need a specific order, you must call this function multiple times:
         *    this.tsParseModifiers({ modified: node, allowedModifiers: ['public'] });
         *    this.tsParseModifiers({ modified: node, allowedModifiers: ["abstract", "readonly"] });
         */
        tsParseModifiers({ modified, allowedModifiers, disallowedModifiers, stopOnStartOfClassStaticBlock, errorTemplate }: {
            modified: any;
            allowedModifiers: any;
            disallowedModifiers: any;
            stopOnStartOfClassStaticBlock: any;
            errorTemplate?: (({ modifier }: {
                modifier: any;
            }) => string) | undefined;
        }): {
            accessibility: any;
        };
        tsParseInOutModifiers(node: any): void;
        parseMaybeUnary(refExpressionErrors: any, sawUnary: any, incDec: any, forInit: any): any;
        tsParseTypeAssertion(): any;
        tsParseTypeArguments(): any;
        exprAllowed: boolean | undefined;
        tsParseHeritageClause(token: any): any;
        tsParseTypeMemberSemicolon(): void;
        tsTryParseAndCatch(f: any): any;
        tsParseSignatureMember(kind: any, node: any): any;
        tsParsePropertyOrMethodSignature(node: any, readonly: any): any;
        tsParseTypeMember(): any;
        tsParseList(kind: any, parseElement: any): any[];
        tsParseObjectTypeMembers(): any[];
        tsParseInterfaceDeclaration(node: any, properties?: {}): any;
        /**
         * Parse interface body, ensuring the closing brace is read outside of type context
         * so that decorators following the interface are properly tokenized.
         */
        tsParseInterfaceBody(): any[];
        tsParseAbstractDeclaration(node: any): any;
        tsIsDeclarationStart(): any;
        tsParseExpressionStatement(node: any, expr: any): any;
        tsParseModuleReference(): any;
        tsIsExportDefaultSpecifier(): boolean;
        tsInAmbientContext(cb: any): any;
        tsCheckLineTerminator(next: any): boolean;
        tsParseModuleOrNamespaceDeclaration(node: any, nested?: boolean): any;
        checkLValSimple(expr: any, bindingType: number | undefined, checkClashes: any): any;
        tsParseTypeAliasDeclaration(node: any): any;
        tsParseDeclaration(node: any, value: any, next: any): any;
        tsTryParseExportDeclaration(): any;
        tsParseImportEqualsDeclaration(node: any, isExport: any): any;
        isExportDefaultSpecifier(): boolean;
        parseTemplate({ isTagged }?: {
            isTagged?: boolean | undefined;
        }): any;
        parseFunction(node: any, statement: any, allowExpressionBody: any, isAsync: any, forInit: any): any;
        yieldPos: any;
        awaitPos: any;
        awaitIdentPos: any;
        parseFunctionBody(node: any, isArrowFunction: boolean | undefined, isMethod: boolean | undefined, forInit: boolean | undefined, tsConfig: any): any;
        parseNew(): any;
        parseExprOp(left: any, leftStartPos: any, leftStartLoc: any, minPrec: any, forInit: any): any;
        parseImportSpecifiers(): any[];
        /**
         * @param {Node} node this may be ImportDeclaration |
         * TsImportEqualsDeclaration
         * @returns AnyImport
         * */
        parseImport(node: Node): any;
        importOrExportOuterKind: string | undefined;
        parseExportDefaultDeclaration(): any;
        parseExportAllDeclaration(node: any, exports: any): any;
        parseDynamicImport(node: any): any;
        parseExport(node: any, exports: any): any;
        checkExport(exports: any, name: any, _: any): void;
        parseMaybeDefault(startPos: any, startLoc: any, left: any): any;
        typeCastToParameter(node: any): any;
        toAssignableList(exprList: any, isBinding: any): any;
        reportReservedArrowTypeParam(node: any): void;
        parseExprAtom(refDestructuringErrors: any, forInit: any, forNew: any): any;
        parseExprAtomDefault(): any;
        parseIdentNode(): any;
        parseVarStatement(node: any, kind: any, allowMissingInitializer?: boolean): any;
        parseStatement(context: any, topLevel: any, exports: any): any;
        parseAccessModifier(): any;
        parsePostMemberNameModifiers(methodOrProp: any): void;
        parseExpressionStatement(node: any, expr: any): any;
        shouldParseExportStatement(): any;
        parseConditional(expr: any, startPos: any, startLoc: any, forInit: any, refDestructuringErrors: any): any;
        parseMaybeConditional(forInit: any, refDestructuringErrors: any): any;
        parseParenItem(node: any): any;
        parseExportDeclaration(node: any): any;
        parseClassId(node: any, isStatement: any): void;
        parseClassPropertyAnnotation(node: any): void;
        parseClassField(field: any): any;
        parseClassMethod(method: any, isGenerator: any, isAsync: any, allowsDirectSuper: any): any;
        isClassMethod(): boolean;
        parseClassElement(constructorAllowsSuper: any): any;
        isClassElementNameStart(): any;
        parseClassSuper(node: any): void;
        parseFunctionParams(node: any): void;
        parseVarId(decl: any, kind: any): void;
        parseArrowExpression(node: any, params: any, isAsync: any, forInit: any): any;
        parseMaybeAssignOrigin(forInit: any, refDestructuringErrors: any, afterLeftParse: any): any;
        potentialArrowAt: any;
        potentialArrowInForAwait: boolean | undefined;
        parseMaybeAssign(forInit: any, refExpressionErrors: any, afterLeftParse: any): any;
        parseAssignableListItem(allowModifiers: any): any;
        checkLValInnerPattern(expr: any, bindingType: number | undefined, checkClashes: any): void;
        parseBindingListItem(param: any): any;
        isAssignable(node: any, isBinding: any): any;
        toAssignable(node: any, isBinding?: boolean, refDestructuringErrors?: {
            shorthandAssign: number;
            trailingComma: number;
            parenthesizedAssign: number;
            parenthesizedBind: number;
            doubleProto: number;
        }): any;
        toAssignableParenthesizedExpression(node: any, isBinding: any, refDestructuringErrors: any): any;
        parseBindingAtom(): any;
        shouldParseArrow(exprList: any): any;
        shouldParseArrowReturnType: any;
        parseParenArrowList(startPos: any, startLoc: any, exprList: any, forInit: any): any;
        parseParenAndDistinguishExpression(canBeArrow: any, forInit: any): any;
        parseTaggedTemplateExpression(base: any, startPos: any, startLoc: any, optionalChainMember: any): any;
        shouldParseAsyncArrow(): any;
        shouldParseAsyncArrowReturnType: any;
        parseSubscriptAsyncArrow(startPos: any, startLoc: any, exprList: any, forInit: any): any;
        parseExprList(close: any, allowTrailingComma: any, allowEmpty: any, refDestructuringErrors: any): any[];
        parseSubscript(base: any, startPos: any, startLoc: any, noCalls: any, maybeAsyncArrow: any, optionalChained: any, forInit: any): any;
        parseGetterSetter(prop: any): void;
        parsePropertyValue(prop: any, isPattern: any, isGenerator: any, isAsync: any, startPos: any, startLoc: any, refDestructuringErrors: any, containsEsc: any): any;
        parseProperty(isPattern: any, refDestructuringErrors: any): any;
        parseCatchClauseParam(): any;
        parseClass(node: any, isStatement: any): any;
        strict: any;
        parseClassFunctionParams(): any;
        parseMethod(isGenerator: any, isAsync: any, allowDirectSuper: any, inClassScope: any, method: any): any;
        parseImportSpecifier(): any;
        parseExportSpecifier(exports: any): any;
        parseTypeOnlyImportExportSpecifier(node: any, isImport: any, isInTypeOnlyImportExport: any): void;
        raiseCommonCheck(pos: any, message: any, recoverable: any): any;
        raiseRecoverable(pos: any, message: any): any;
        raise(pos: any, message: any): any;
        updateContext(prevType: any): any;
        jsx_parseOpeningElementAt(startPos: any, startLoc: any): any;
        enterScope(flags: any): void;
        exitScope(): void;
        hasImport(name: any, allowShadow: any): boolean;
        maybeExportDefined(scope: any, name: any): void;
        declareName(name: any, bindingType: any, pos: any): void;
        checkLocalExport(id: any): void;
    };
    [x: string]: any;
    get acornTypeScript(): any;
    parse(input: any, options2: any): any;
    parseExpressionAt(input: any, pos: any, options2: any): any;
};
//# sourceMappingURL=index.d.ts.map