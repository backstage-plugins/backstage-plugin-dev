import winston from "winston";
import {OpenApiEntityProcessor} from "./OpenApiEntityProcessor";
import {ApiEntity, Entity} from "@backstage/catalog-model";
import {AlphaEntity} from "@backstage/catalog-model/alpha";
import _ from "lodash";
import 'fetch-mock-jest';
import {FetchMockStatic} from "fetch-mock";
import fetch from "node-fetch";

jest.mock(
    'node-fetch',
    () => require('fetch-mock-jest').sandbox()
);

const mockFetch = (fetch as unknown) as FetchMockStatic;

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [
        new winston.transports.Console(),
    ]
});

const options = {logger};

const DEFAULT_ENTITY = (): Entity => ({
    "apiVersion": "backstage.io/v1alpha1",
    "kind": "API",
    "metadata": {
        "namespace": "default",
        "annotations": {
            "tw.com/openapi-doc-url": "http://service.com/v3/api-docs.yaml"
        },
        "name": "example-openapi-api"
    },
    "relations": [],
    "spec": {
        "type": "openapi",
        "lifecycle": "experimental",
        "owner": "guests",
        "system": "examples",
        "definition": "openapi: 3.0.1\ninfo:\n  title: OpenAPI definition\n  version: v0\nservers: []\npaths: {}\ncomponents:\n  schemas: {}\n"
    }
});

const testEntity = (overrides: {} = {}): Entity => {
    return _.merge(DEFAULT_ENTITY(), overrides);
}

describe("OpenApiEntityProcessor", () => {

    describe("getProcessorName", () => {
        it("returns name of the processor", () => {
            const processor = new OpenApiEntityProcessor(options);

            const processorName = processor.getProcessorName();

            expect(processorName).toEqual("tw.OpenApiEntityProcessor");
        });
    })

    describe("postProcessEntity", () => {
        const processor = new OpenApiEntityProcessor(options);

        describe("entity kind is not API", () => {
            it("returns the same entity", async () => {
                const entity = testEntity({kind: "Component"});

                const processedEntity = await processor.postProcessEntity(entity);

                expect(processedEntity).toBe(entity);
            });
        });

        describe("API entity type is not openapi", () => {
            it("returns the same entity", async () => {
                const entity = testEntity({spec: {type: "grpc"}})

                const processedEntity = await processor.postProcessEntity(entity);

                expect(processedEntity).toBe(entity);
            });
        });

        describe("API entity with type openapi does not contain the openapi-doc-url annotation", () => {
            it("returns the same entity", async () => {
                const entity = testEntity();
                delete entity.metadata.annotations;

                const processedEntity = await processor.postProcessEntity(entity);

                expect(processedEntity).toBe(entity);
            });
        });


        describe("API entity with type openapi contains the openapi-doc-url annotation", () => {

            beforeEach(() => mockFetch.reset());

            const processor = new OpenApiEntityProcessor(options);

            it("fetches API definition from openapi-doc-url", async () => {
                mockFetch.get('http://service.com/v3/api-docs.yaml', "Latest API definition");


                await processor.postProcessEntity(testEntity());

                expect(mockFetch).toHaveFetched('http://service.com/v3/api-docs.yaml');
            });

            describe("API definition fetch is successful", () => {
                it("returns the entity with updated api definition", async () => {
                    mockFetch.get('http://service.com/v3/api-docs.yaml', "Latest API definition");

                    const processedEntity = await processor.postProcessEntity(testEntity());

                    const apiEntity = processedEntity as ApiEntity;
                    expect(apiEntity.spec.definition).toEqual("Latest API definition");
                });
            });

            describe("API definition fetch is unsuccessful", () => {
                it("adds error status to the entity", async () => {
                    mockFetch.get('http://service.com/v3/api-docs.yaml', {
                        body: "Internal Server Error",
                        status: 500,
                    });

                    const processedEntity = await processor.postProcessEntity(testEntity());

                    const alphaEntity = processedEntity as AlphaEntity;

                    expect(alphaEntity.status).toBeDefined();
                    expect(alphaEntity.status!.items).toHaveLength(1);
                    expect(alphaEntity.status!.items![0].level).toBe("error");
                    expect(alphaEntity.status!.items![0].message).toBe("Request failed with 500 Error");
                    expect(alphaEntity.status!.items![0].type).toBe("backstage.io/catalog-processing");
                    expect(alphaEntity.status!.items![0].error).toBeDefined();
                });

                describe("error is unknown", () => {
                    it("adds error status with message Unknown error", async () => {
                        mockFetch.get('http://service.com/v3/api-docs.yaml', () => {
                            throw "unknown error";
                        });

                        const processedEntity = await processor.postProcessEntity(testEntity());

                        const alphaEntity = processedEntity as AlphaEntity;

                        expect(alphaEntity.status).toBeDefined();
                        expect(alphaEntity.status!.items).toHaveLength(1);
                        expect(alphaEntity.status!.items![0].level).toBe("error");
                        expect(alphaEntity.status!.items![0].message).toBe("Unknown error");
                        expect(alphaEntity.status!.items![0].type).toBe("backstage.io/catalog-processing");
                        expect(alphaEntity.status!.items![0].error).toBeDefined();
                    });
                });
            });
        });
    });
});




