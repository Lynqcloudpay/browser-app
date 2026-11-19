import { Router } from 'express';
import { route } from './helpers';
import {
  FILM_MODELS,
  OPUSCAR_HOME,
  FilmRequest,
  getFilmStatus,
  libraryInstalled,
  listStyles,
  startFilm,
  stopFilm,
  validateFilmRequest,
} from '../engine/claudeFilm';

/** Claude films: make a short film with the claude CLI (see engine/claudeFilm.ts). */
export const filmsRouter = Router();

filmsRouter.get(
  '/films/status',
  route((_req, res) => {
    res.json({
      installed: libraryInstalled(),
      home: OPUSCAR_HOME,
      styles: listStyles(),
      models: FILM_MODELS,
      status: getFilmStatus(),
    });
  }),
);

filmsRouter.post(
  '/films',
  route((req, res) => {
    let request: FilmRequest;
    try {
      request = validateFilmRequest(req.body, listStyles());
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid film request.' });
      return;
    }
    const result = startFilm(request);
    if (!result.started) {
      res.status(409).json({ error: result.reason || 'The film did not start.' });
      return;
    }
    res.json({ started: true });
  }),
);

filmsRouter.post(
  '/films/stop',
  route((_req, res) => {
    res.json(stopFilm());
  }),
);
