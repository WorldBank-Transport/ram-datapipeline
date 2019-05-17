'use strict';
import { featureCollection } from '@turf/helpers';
import within from '@turf/within';
import buffer from '@turf/buffer';
import bbox from '@turf/bbox';

/**
 * Create an array filled with a range of numbers starting at {start} and ending
 * at {end - 1}
 * @param  {Number} start
 * @param  {Number} end
 * @return {Array}
 *   Array with range [0, 1, 2 ...]
 */
export function range (start, end) {
  let res = [];
  for (let i = start; i < end; i++) { res.push(i); }
  return res;
}

/**
 * Get all origins in the given area.
 * @param  {Feature} area
 * @param  {FeatureCollection} origins
 * @return {FeatureCollection}
 *   Origins in the given area
 */
export function originsInRegion (area, origins) {
  const result = within(origins, featureCollection([area]));
  return result;
}

/**
 * Get the poi within a buffer around area.
 * The buffer distance is calculated based of the kilometers traveled at {speed}
 * during {time} seconds.
 * @param  {Feature} area
 * @param  {number} time    Value in seconds
 * @param  {number} speed   Value in km/h
 * @param  {FeatureCollection} poi     Points of Interest
 *
 * @throws RangeError
 *
 * @return {FeatureCollection}
 *   The Points of Interest in the buffered area.
 */
export function poisInBuffer (area, poi, time, speed) {
  const distance = (time / 3600) * speed;
  const bufferedArea = buffer(area, distance, 'kilometers');
  const [e, s, w, n] = bbox(bufferedArea);

  if (e < -180 && w > 180 && s < -85 && n > 85) {
    throw new RangeError('World buffer overflow');
  }

  const result = within(poi, featureCollection([bufferedArea]));
  return result;
}
