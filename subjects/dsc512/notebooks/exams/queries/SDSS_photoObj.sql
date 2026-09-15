-- Pull camera catalog in a region
SELECT 
p.objid,p.ra,p.dec
FROM PhotoObj AS p
WHERE 
 p.ra BETWEEN 10 AND 13
 AND p.dec BETWEEN 10 AND 13