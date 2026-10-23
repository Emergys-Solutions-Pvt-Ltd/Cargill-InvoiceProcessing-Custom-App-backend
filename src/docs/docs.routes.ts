import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { openApiDocument } from './openapi.js';

// Mounted at /api/docs - public, no bearer token required
const router = Router();

/** GET /api/docs/openapi.json[?download=1] - the OpenAPI document (as a file with download=1) */
router.get('/openapi.json', (req, res) => {
  if (req.query.download !== undefined) res.attachment('cargill-custom-apps-openapi.json');
  res.json(openApiDocument);
});

/** GET /api/docs - Swagger UI; loads the spec from /api/docs/openapi.json (link shown in the top bar) */
router.use(
  '/',
  swaggerUi.serve,
  swaggerUi.setup(undefined, {
    customSiteTitle: 'Cargill Custom Apps API',
    swaggerOptions: { url: '/api/docs/openapi.json', persistAuthorization: true, displayRequestDuration: true },
  }),
);

export default router;
