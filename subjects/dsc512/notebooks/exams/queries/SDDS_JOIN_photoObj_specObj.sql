-- Find best match between camera and spectrometer catalogs
SELECT 
p.objid,p.ra,p.dec,
s.specobjid,s.ra,s.dec
FROM PhotoObj AS p
JOIN SpecObj AS s ON s.bestobjid = p.objid
WHERE 
 p.ra BETWEEN 10 AND 13
 AND p.dec BETWEEN 10 AND 13