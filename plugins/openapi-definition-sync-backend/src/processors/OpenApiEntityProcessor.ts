import {ApiEntity, Entity, stringifyEntityRef,} from '@backstage/catalog-model';
import {CatalogProcessor} from '@backstage/plugin-catalog-backend';
import fetch, {Response} from "node-fetch";
import {Logger} from "winston";
import {isError, ResponseError, SerializedError, serializeError, stringifyError,} from "@backstage/errors";
import {ENTITY_STATUS_CATALOG_PROCESSING_TYPE} from "@backstage/catalog-client";

export const OPENAPI_DOC_URL_ANNOTATION = "tw.com/openapi-doc-url";

export interface ProcessorOptions {
    logger: Logger;
}

export class OpenApiEntityProcessor implements CatalogProcessor {
    private logger: Logger;

    constructor(options: ProcessorOptions) {
        this.logger = options.logger;
    }

    getProcessorName = (): string => "tw.OpenApiEntityProcessor";

    postProcessEntity = async (entity: Entity): Promise<Entity> => {
        if (entity.kind !== "API") {
            return entity;
        }

        const apiEntity = entity as ApiEntity;
        if (apiEntity.spec.type !== "openapi") {
            return entity;
        }

        const apiDocUrl = entity.metadata.annotations?.[OPENAPI_DOC_URL_ANNOTATION];
        if (!apiDocUrl) {
            return entity;
        }
        try {
            apiEntity.spec.definition = await fetch(apiDocUrl).then(checkOk).then(r => r.text());
            this.logger.info(`Updated API definition for '${stringifyEntityRef(entity)}'`)

            return apiEntity;
        } catch (error) {
            this.logger.warn({
                message: `Can't fetch the latest API definition for '${stringifyEntityRef(entity)}'`,
                error
            });

            return withErrorStatus(entity, error);
        }
    };
}

const withErrorStatus = (entity: Entity, error: unknown): Entity => ({...entityStatusWithError(error), ...entity});

const checkOk = async (r: Response): Promise<Response> => {
    if (!r.ok) {
        throw await ResponseError.fromResponse(r);
    }

    return r;
};

const serializedError = (e: unknown): SerializedError => {
    if (!isError(e)) {
        return {
            name: "Unknown error",
            message: stringifyError(e)
        };
    }

    return serializeError(e);
};

const entityStatusWithError = (e: unknown) => ({
    status: {
        items: [{
            type: ENTITY_STATUS_CATALOG_PROCESSING_TYPE,
            level: "error",
            message: isError(e) ? e.message : "Unknown error",
            error: serializedError(e)
        }]
    }
});
